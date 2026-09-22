import { execFile } from 'child_process';

export interface RunGitOptions {
  cwd: string;
  input?: string;
  signal?: AbortSignal;
  maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export class GitCliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly isGitMissing: boolean = false,
  ) {
    super(message);
    this.name = 'GitCliError';
  }
}

export function runGit(args: string[], options: RunGitOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const isGitMissing = code === 'ENOENT';
          const exitCode = typeof code === 'number' ? code : null;
          reject(
            new GitCliError(
              `git ${args[0]} failed: ${stderr || error.message}`,
              exitCode,
              stderr,
              isGitMissing,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );

    if (child.stdin) {
      if (options.input !== undefined) {
        child.stdin.end(options.input, 'utf8');
      } else {
        child.stdin.end();
      }
    }
  });
}
