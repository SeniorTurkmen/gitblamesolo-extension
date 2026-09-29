import { GitCliError, runGit } from './gitCli';

export interface RemoteCommitLink {
  /** Hosting service name for labels such as "Open on GitHub". */
  provider: string;
  url: string;
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

export function buildCommitLink(remoteUrl: string, sha: string): RemoteCommitLink | undefined {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) {
    return undefined;
  }
  const { host, path } = remote;

  if (host === 'bitbucket.org') {
    return { provider: 'Bitbucket', url: `https://${host}/${path}/commits/${sha}` };
  }
  if (host === 'ssh.dev.azure.com' || host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) {
    // ssh: v3/org/project/repo, https: org/project/_git/repo
    const parts = path.split('/').filter((part) => part !== '_git');
    const [org, project, repo] = parts[0] === 'v3' ? parts.slice(1) : parts;
    if (!org || !project || !repo) {
      return undefined;
    }
    return { provider: 'Azure DevOps', url: `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}` };
  }
  if (host.includes('gitlab')) {
    return { provider: 'GitLab', url: `https://${host}/${path}/-/commit/${sha}` };
  }
  // GitHub, GitHub Enterprise, Gitea, Forgejo, and most other hosts use /commit/<sha>.
  const provider = host === 'github.com' ? 'GitHub' : 'Remote';
  return { provider, url: `https://${host}/${path}/commit/${sha}` };
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

export async function getCommitLink(repoRoot: string, sha: string): Promise<RemoteCommitLink | undefined> {
  const remoteUrl = await getDefaultRemoteUrl(repoRoot);
  return remoteUrl ? buildCommitLink(remoteUrl, sha) : undefined;
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
