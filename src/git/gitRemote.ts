import { GitCliError, runGit } from './gitCli';

export interface RemoteCommitLink {
  /** Hosting service name for labels such as "Open on GitHub". */
  provider: string;
  url: string;
  /** The pull request (merge request on GitLab) the commit message names, when the host is known. */
  pullRequest?: { number: number; url: string };
}

/**
 * Finds the pull request number in the message formats hosting services
 * write when merging: GitHub's merge and squash commits, GitLab's
 * "See merge request", Bitbucket's "(pull request #N)", and Azure DevOps's
 * "Merged PR N:".
 */
export function parsePullRequestNumber(message: string): number | undefined {
  const summary = message.split('\n', 1)[0];
  const match =
    /^Merge pull request #(\d+) from /.exec(summary) ??
    /\(#(\d+)\)\s*$/.exec(summary) ??
    /^Merged PR (\d+):/.exec(summary) ??
    /\(pull request #(\d+)\)/.exec(summary) ??
    /^See merge request \S*!(\d+)\s*$/m.exec(message);
  return match ? parseInt(match[1], 10) : undefined;
}

interface RemoteLocation {
  host: string;
  /** Repository path on the host without leading slash or ".git", e.g. "owner/repo". */
  path: string;
}

/**
 * Normalizes the remote URL forms git accepts: https://host/path,
 * ssh://user@host:port/path, and scp-like user@host:path.
 */
export function parseRemoteUrl(remoteUrl: string): RemoteLocation | undefined {
  const url = remoteUrl.trim();
  let host: string;
  let repoPath: string;

  const scpLike = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url);
  if (scpLike && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (!['http:', 'https:', 'ssh:', 'git:', 'git+ssh:'].includes(parsed.protocol)) {
      return undefined;
    }
    // An https remote keeps its port (self-hosted servers); an ssh port says nothing about the web UI.
    host = parsed.protocol.startsWith('http') ? parsed.host : parsed.hostname;
    repoPath = decodeURIComponent(parsed.pathname);
  }

  repoPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!host || !repoPath) {
    return undefined;
  }
  return { host: host.toLowerCase(), path: repoPath };
}

/** "PR #12" on most hosts, "MR !12" on GitLab, which calls them merge requests. */
export function pullRequestLabel(provider: string, prNumber: number): string {
  return provider === 'GitLab' ? `MR !${prNumber}` : `PR #${prNumber}`;
}

/**
 * Links to a commit, and to the pull request its message names, on the
 * remote's web UI. Pass the commit message to look for a pull request.
 */
export function buildCommitLink(remoteUrl: string, sha: string, message = ''): RemoteCommitLink | undefined {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) {
    return undefined;
  }
  const { host, path } = remote;
  const prNumber = parsePullRequestNumber(message);
  const withPullRequest = (link: RemoteCommitLink, prUrl: string | undefined): RemoteCommitLink =>
    prNumber !== undefined && prUrl ? { ...link, pullRequest: { number: prNumber, url: prUrl } } : link;

  if (host === 'bitbucket.org') {
    const base = `https://${host}/${path}`;
    return withPullRequest({ provider: 'Bitbucket', url: `${base}/commits/${sha}` }, `${base}/pull-requests/${prNumber}`);
  }
  if (host === 'ssh.dev.azure.com' || host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) {
    // ssh: v3/org/project/repo, https: org/project/_git/repo
    const parts = path.split('/').filter((part) => part !== '_git');
    const [org, project, repo] = parts[0] === 'v3' ? parts.slice(1) : parts;
    if (!org || !project || !repo) {
      return undefined;
    }
    const base = `https://dev.azure.com/${org}/${project}/_git/${repo}`;
    return withPullRequest({ provider: 'Azure DevOps', url: `${base}/commit/${sha}` }, `${base}/pullrequest/${prNumber}`);
  }
  if (host.includes('gitlab')) {
    const base = `https://${host}/${path}`;
    return withPullRequest({ provider: 'GitLab', url: `${base}/-/commit/${sha}` }, `${base}/-/merge_requests/${prNumber}`);
  }
  // GitHub, GitHub Enterprise, Gitea, Forgejo, and most other hosts use /commit/<sha>.
  // Only github.com is known to use /pull/<n>; other hosts get no pull request link.
  const base = `https://${host}/${path}`;
  if (host === 'github.com') {
    return withPullRequest({ provider: 'GitHub', url: `${base}/commit/${sha}` }, `${base}/pull/${prNumber}`);
  }
  return { provider: 'Remote', url: `${base}/commit/${sha}` };
}

const remoteUrlCache = new Map<string, Promise<string | undefined>>();
const userEmailCache = new Map<string, Promise<string | undefined>>();

/** The URL of the remote git would push/fetch by default (origin, or the branch's upstream). */
export function getDefaultRemoteUrl(repoRoot: string): Promise<string | undefined> {
  return cached(remoteUrlCache, repoRoot, async () => {
    // Applies url.<base>.insteadOf rewrites and never touches the network. Fails when no remote is configured.
    const url = (await runGit(['ls-remote', '--get-url'], { cwd: repoRoot })).trim();
    return url || undefined;
  });
}

export function getCurrentUserEmail(repoRoot: string): Promise<string | undefined> {
  return cached(userEmailCache, repoRoot, async () => {
    const email = (await runGit(['config', 'user.email'], { cwd: repoRoot })).trim();
    return email || undefined;
  });
}

export async function getCommitLink(repoRoot: string, sha: string, message = ''): Promise<RemoteCommitLink | undefined> {
  const remoteUrl = await getDefaultRemoteUrl(repoRoot);
  return remoteUrl ? buildCommitLink(remoteUrl, sha, message) : undefined;
}

export function clearRemoteCaches(): void {
  remoteUrlCache.clear();
  userEmailCache.clear();
}

function cached(
  cache: Map<string, Promise<string | undefined>>,
  key: string,
  compute: () => Promise<string | undefined>,
): Promise<string | undefined> {
  let promise = cache.get(key);
  if (!promise) {
    promise = compute().catch((err) => {
      if (err instanceof GitCliError) {
        return undefined;
      }
      cache.delete(key);
      throw err;
    });
    cache.set(key, promise);
  }
  return promise;
}
