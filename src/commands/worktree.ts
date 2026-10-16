import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { GitCliError } from '../git/gitCli';
import { getBranches } from '../git/gitHistory';
import {
  addWorktree,
  appendToGitignore,
  deleteBranch,
  deleteRemoteBranch,
  describeBranchStatus,
  describeLocation,
  freeWorktreePath,
  hasLocalChanges,
  isIgnored,
  layoutFolder,
  planRemoval,
  pruneWorktrees,
  RemoteBranch,
  remoteBranchLabel,
  removeWorktree,
  resolveWorktreeFolder,
  samePath,
  unmergedBranches,
  Worktree,
  WorktreeLayout,
  WorktreeSource,
} from '../git/gitWorktree';
import { isOpenInWindow, RepositoryWorktrees, worktreeLabel, WorktreeNode, WorktreeTreeProvider } from '../views/worktreeTree';
import { showRepositoryHistory } from './history';

function errorText(err: unknown): string {
  if (err instanceof GitCliError) {
    return err.stderr.trim() || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function isWorktreeNode(arg: unknown): arg is WorktreeNode & { kind: 'worktree' } {
  return !!arg && typeof arg === 'object' && (arg as WorktreeNode).kind === 'worktree';
}

/** The repository a command acts on: the clicked one, the only one, or one the user picks. */
async function pickRepository(
  repositories: readonly RepositoryWorktrees[],
  arg: unknown,
  placeHolder: string,
): Promise<RepositoryWorktrees | undefined> {
  if (arg && typeof arg === 'object' && 'repository' in arg) {
    return (arg as WorktreeNode).repository;
  }
  if (repositories.length <= 1) {
    if (repositories.length === 0) {
      void vscode.window.showInformationMessage('Git Blame Solo: no git repository is open.');
    }
    return repositories[0];
  }
  const picked = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: path.basename(repository.mainRoot),
      description: repository.mainRoot,
      repository,
    })),
    { placeHolder },
  );
  return picked?.repository;
}

type SourceKind = WorktreeSource['kind'];

async function pickSource(repository: RepositoryWorktrees): Promise<WorktreeSource | undefined> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: '$(add) New branch', description: 'Create a branch for the worktree', source: 'newBranch' as SourceKind },
      { label: '$(git-branch) Existing branch', description: 'Check out a local branch', source: 'branch' as SourceKind },
      { label: '$(cloud) Remote branch', description: 'Check out a remote branch as a new local branch', source: 'remoteBranch' as SourceKind },
    ],
    { placeHolder: 'What should the new worktree check out?' },
  );
  if (!kind) {
    return undefined;
  }
  const branches = await getBranches(repository.mainRoot);
  const checkedOut = new Set(repository.worktrees.map((w) => w.branch).filter(Boolean));

  if (kind.source === 'newBranch') {
    const name = await vscode.window.showInputBox({
      prompt: 'Name of the new branch',
      placeHolder: 'feature/my-change',
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Enter a branch name.';
        }
        if (/\s|\.\.|[~^:?*[\\]|^[-/.]|[/.]$|\.lock$|@\{/.test(trimmed)) {
          return 'This is not a valid branch name.';
        }
        return branches.local.includes(trimmed) ? `A branch named ${trimmed} already exists.` : undefined;
      },
    });
    if (!name) {
      return undefined;
    }
    const current = branches.current;
    const bases = [
      ...(current ? [{ label: current, description: 'current branch' }] : []),
      ...branches.local.filter((b) => b !== current).map((b) => ({ label: b, description: 'local' })),
      ...branches.remote.map((b) => ({ label: b, description: 'remote' })),
    ];
    const base = await vscode.window.showQuickPick(bases, { placeHolder: `Branch ${name.trim()} starts from…` });
    return base && { kind: 'newBranch', branch: name.trim(), base: base.label };
  }

  if (kind.source === 'branch') {
    const free = branches.local.filter((b) => !checkedOut.has(b));
    if (free.length === 0) {
      void vscode.window.showInformationMessage('Git Blame Solo: every local branch is already checked out in a worktree.');
      return undefined;
    }
    const branch = await vscode.window.showQuickPick(free, { placeHolder: 'Branch to check out in the new worktree' });
    return branch ? { kind: 'branch', branch } : undefined;
  }

  const remote = await vscode.window.showQuickPick(branches.remote, { placeHolder: 'Remote branch to check out' });
  if (!remote) {
    return undefined;
  }
  const local = remote.replace(/^[^/]+\//, '');
  if (branches.local.includes(local)) {
    void vscode.window.showWarningMessage(
      `Git Blame Solo: a local branch ${local} already exists; create the worktree from it as an existing branch.`,
    );
    return undefined;
  }
  return { kind: 'remoteBranch', branch: local, remoteBranch: remote };
}

/** The folder the new worktree goes in, asking which layout to use when the repository has none yet. */
async function pickFolder(repository: RepositoryWorktrees): Promise<string | undefined> {
  const resolved = resolveWorktreeFolder(getConfig().worktreesFolder, repository.mainRoot, repository.worktrees);
  let folder = resolved?.folder;
  let layout = resolved?.layout;
  if (!folder) {
    const name = path.basename(repository.mainRoot);
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: `../${name}.worktrees/`,
          description: 'Recommended: next to the repository',
          detail: 'Keeps worktrees out of the repository, its searches, and its file watchers.',
          layout: 'sibling' as WorktreeLayout,
        },
        {
          label: '.worktrees/',
          description: 'Inside the repository',
          detail: 'Needs .worktrees/ in .gitignore, which is offered next.',
          layout: 'inRepo' as WorktreeLayout,
        },
      ],
      { placeHolder: 'Where should worktrees of this repository go? Set gitBlameSolo.worktrees.folder to skip this.' },
    );
    if (!picked) {
      return undefined;
    }
    layout = picked.layout;
    folder = layoutFolder(repository.mainRoot, layout);
  }
  if (layout === 'inRepo' && !(await isIgnored(repository.mainRoot, '.worktrees/').catch(() => true))) {
    const add = 'Add to .gitignore';
    const answer = await vscode.window.showWarningMessage(
      'Git doesn\'t ignore .worktrees/, so the worktrees would show up as untracked files in the repository.',
      { modal: true },
      add,
      'Continue Without',
    );
    if (!answer) {
      return undefined;
    }
    if (answer === add) {
      await appendToGitignore(repository.mainRoot, '.worktrees/');
    }
  }
  return folder;
}

async function offerToOpen(worktreePath: string, label: string): Promise<void> {
  const newWindow = 'Open in New Window';
  const here = 'Open Here';
  const answer = await vscode.window.showInformationMessage(
    `Git Blame Solo: created worktree ${label} in ${worktreePath}.`,
    newWindow,
    here,
  );
  if (answer) {
    await openWorktreeFolder(worktreePath, answer === newWindow);
  }
}

function openWorktreeFolder(worktreePath: string, forceNewWindow: boolean): Thenable<unknown> {
  return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), { forceNewWindow });
}

export async function createWorktree(provider: WorktreeTreeProvider, arg?: unknown): Promise<void> {
  const repository = await pickRepository(await provider.getAllRepositories(), arg, 'Pick a repository to add a worktree to');
  if (!repository) {
    return;
  }
  const source = await pickSource(repository);
  if (!source) {
    return;
  }
  const folder = await pickFolder(repository);
  if (!folder) {
    return;
  }
  const proposed = freeWorktreePath(folder, source.branch);
  const worktreePath = await vscode.window.showInputBox({
    prompt: `Folder for the worktree of ${source.branch}`,
    value: proposed,
    valueSelection: [proposed.length - path.basename(proposed).length, proposed.length],
    validateInput: (value) => {
      const resolved = path.resolve(repository.mainRoot, value.trim());
      if (!value.trim()) {
        return 'Enter a folder.';
      }
      if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
        return 'This folder already exists and isn\'t empty.';
      }
      return undefined;
    },
  });
  if (!worktreePath) {
    return;
  }
  const target = path.resolve(repository.mainRoot, worktreePath.trim());
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Git Blame Solo: creating worktree ${source.branch}` },
      () => addWorktree(repository.mainRoot, target, source),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Git Blame Solo: could not create the worktree. ${errorText(err)}`);
    return;
  }
  await provider.refresh();
  await offerToOpen(target, source.branch);
}

export async function openWorktree(arg: unknown, forceNewWindow: boolean): Promise<void> {
  if (isWorktreeNode(arg)) {
    await openWorktreeFolder(arg.worktree.path, forceNewWindow);
  }
}

export async function revealWorktree(arg: unknown): Promise<void> {
  if (isWorktreeNode(arg)) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(arg.worktree.path));
  }
}

export async function copyWorktreePath(arg: unknown): Promise<void> {
  if (isWorktreeNode(arg)) {
    await vscode.env.clipboard.writeText(arg.worktree.path);
    void vscode.window.setStatusBarMessage('$(check) Copied the worktree path to clipboard', 3000);
  }
}

export function showWorktreeLog(arg: unknown): void {
  if (isWorktreeNode(arg)) {
    showRepositoryHistory(arg.worktree.path);
  }
}

const SKIP_REASONS = {
  main: 'the main worktree can\'t be deleted',
  current: 'open in this window',
  locked: 'locked',
} as const;

function bullet(repository: RepositoryWorktrees, worktree: Worktree, note?: string): string {
  return `• ${worktreeLabel(worktree)} (${describeLocation(repository.mainRoot, worktree.path)})${note ? ` — ${note}` : ''}`;
}

/**
 * Deletes worktrees after the user confirms, and the branches the user picks
 * of theirs, warning before deleting a branch that isn't merged. Picked
 * branches that are on a remote are deleted there too when the user agrees.
 */
async function deleteWorktrees(provider: WorktreeTreeProvider, repository: RepositoryWorktrees, worktrees: Worktree[]): Promise<void> {
  const plan = planRemoval(worktrees, isOpenInWindow);
  const skipped = plan.skip.filter((s) => s.reason !== 'main' || worktrees.length === 1);
  if (plan.remove.length === 0) {
    void vscode.window.showInformationMessage(
      `Git Blame Solo: nothing to delete. ${skipped.map((s) => `${worktreeLabel(s.worktree)}: ${SKIP_REASONS[s.reason]}.`).join(' ')}`,
    );
    return;
  }

  const dirty = new Set<Worktree>();
  await Promise.all(
    plan.remove.map(async (worktree) => {
      if (!worktree.prunable && (await hasLocalChanges(worktree.path))) {
        dirty.add(worktree);
      }
    }),
  );
  const lines = plan.remove.map((worktree) =>
    bullet(
      repository,
      worktree,
      dirty.has(worktree) ? 'has uncommitted changes, which will be lost' : worktree.prunable ? 'folder already missing' : undefined,
    ),
  );
  if (skipped.length > 0) {
    lines.push('', 'Kept:', ...skipped.map((s) => bullet(repository, s.worktree, SKIP_REASONS[s.reason])));
  }
  const count = plan.remove.length;
  const confirmed = await vscode.window.showWarningMessage(
    count === 1 ? `Delete worktree ${worktreeLabel(plan.remove[0])}?` : `Delete ${count} worktrees?`,
    { modal: true, detail: `${lines.join('\n')}\n\nYou choose which branches to delete next.` },
    'Delete',
  );
  if (!confirmed) {
    return;
  }

  const branches = plan.remove.map((w) => w.branch).filter((b): b is string => !!b);
  let branchesToDelete: string[] = [];
  if (branches.length > 0) {
    const picked = await vscode.window.showQuickPick(
      branches.map((branch) => ({
        label: branch,
        description: describeBranchStatus(repository.statuses.get(branch), repository.defaultBranch),
        iconPath: new vscode.ThemeIcon(repository.statuses.get(branch)?.merged ? 'check' : 'warning'),
      })),
      {
        canPickMany: true,
        placeHolder: 'Also delete these branches? Pick none to keep them all; Escape cancels everything.',
        ignoreFocusOut: true,
      },
    );
    if (!picked) {
      return;
    }
    branchesToDelete = picked.map((item) => item.label);
  }

  const unmerged = unmergedBranches(branchesToDelete, repository.statuses);
  if (unmerged.length > 0) {
    const base = repository.defaultBranch ?? 'the default branch';
    const answer = await vscode.window.showWarningMessage(
      unmerged.length === 1
        ? `Branch ${unmerged[0]} isn't merged into ${base}.`
        : `${unmerged.length} branches aren't merged into ${base}.`,
      {
        modal: true,
        detail: `${unmerged
          .map((b) => `• ${b} — ${describeBranchStatus(repository.statuses.get(b))}`)
          .join('\n')}\n\nTheir commits are lost unless another branch or a remote has them.`,
      },
      'Delete Anyway',
    );
    if (!answer) {
      return;
    }
  }

  const onRemote = new Map<string, RemoteBranch>();
  for (const branch of branchesToDelete) {
    const remote = repository.statuses.get(branch)?.remote;
    if (remote) {
      onRemote.set(branch, remote);
    }
  }
  let deleteFromRemote = false;
  if (onRemote.size > 0) {
    const answer = await vscode.window.showWarningMessage(
      onRemote.size === 1
        ? `Also delete ${remoteBranchLabel([...onRemote.values()][0])} from the remote?`
        : `Also delete ${onRemote.size} branches from the remote?`,
      {
        modal: true,
        detail: `${[...onRemote]
          .map(([branch, remote]) => `• ${branch} → ${remoteBranchLabel(remote)}`)
          .join('\n')}\n\nThis deletes them for everyone using the remote. Local Only keeps them there.`,
      },
      'Delete from Remote',
      'Local Only',
    );
    if (!answer) {
      return;
    }
    deleteFromRemote = answer === 'Delete from Remote';
  }

  const failures: string[] = [];
  let removed = 0;
  let deletedBranches = 0;
  let deletedRemoteBranches = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Git Blame Solo: deleting worktrees' },
    async () => {
      for (const worktree of plan.remove) {
        try {
          if (!worktree.prunable) {
            await removeWorktree(repository.mainRoot, worktree.path, dirty.has(worktree));
          }
          removed++;
        } catch (err) {
          failures.push(`${worktreeLabel(worktree)}: ${errorText(err)}`);
          // Leave the branch of a worktree that is still there.
          branchesToDelete = branchesToDelete.filter((b) => b !== worktree.branch);
        }
      }
      await pruneWorktrees(repository.mainRoot).catch(() => undefined);
      for (const branch of branchesToDelete) {
        try {
          await deleteBranch(repository.mainRoot, branch);
          deletedBranches++;
        } catch (err) {
          failures.push(`branch ${branch}: ${errorText(err)}`);
          continue;
        }
        const remote = onRemote.get(branch);
        if (deleteFromRemote && remote) {
          try {
            await deleteRemoteBranch(repository.mainRoot, remote);
            deletedRemoteBranches++;
          } catch (err) {
            failures.push(`remote branch ${remoteBranchLabel(remote)}: ${errorText(err)}`);
          }
        }
      }
    },
  );
  await provider.refresh();

  const remoteSummary = deleteFromRemote
    ? `, ${deletedRemoteBranches} of them also from the remote`
    : '';
  const summary = `Git Blame Solo: deleted ${removed} ${removed === 1 ? 'worktree' : 'worktrees'} and ${deletedBranches} ${
    deletedBranches === 1 ? 'branch' : 'branches'
  }${remoteSummary}.`;
  if (failures.length > 0) {
    void vscode.window.showErrorMessage(`${summary} Failed: ${failures.join('; ')}`);
  } else {
    void vscode.window.showInformationMessage(summary);
  }
}

/** Deletes the clicked worktree, or every selected one when several are selected. */
export async function deleteSelectedWorktrees(provider: WorktreeTreeProvider, arg: unknown, selected?: unknown): Promise<void> {
  const nodes = (Array.isArray(selected) && selected.length > 0 ? selected : [arg]).filter(isWorktreeNode);
  if (nodes.length === 0) {
    return;
  }
  // Worktrees of different repositories are deleted one repository at a time.
  const byRepository = new Map<RepositoryWorktrees, Worktree[]>();
  for (const node of nodes) {
    byRepository.set(node.repository, [...(byRepository.get(node.repository) ?? []), node.worktree]);
  }
  for (const [repository, worktrees] of byRepository) {
    await deleteWorktrees(provider, repository, worktrees);
  }
}

/** Offers to delete every linked worktree of a repository. */
export async function cleanUpWorktrees(provider: WorktreeTreeProvider, arg?: unknown): Promise<void> {
  await provider.refresh();
  const repositories = provider.getRepositories();
  if (repositories.length === 0) {
    void vscode.window.showInformationMessage('Git Blame Solo: no repository has linked worktrees.');
    return;
  }
  const repository = await pickRepository(repositories, arg, 'Pick a repository to clean up the worktrees of');
  if (!repository) {
    return;
  }
  // Read again: the picked node may be from before the refresh.
  const fresh = repositories.find((r) => samePath(r.mainRoot, repository.mainRoot)) ?? repository;
  await deleteWorktrees(
    provider,
    fresh,
    fresh.worktrees.filter((w) => !w.isMain),
  );
}
