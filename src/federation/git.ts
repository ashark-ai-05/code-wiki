import { spawn } from 'node:child_process';

export interface SpawnGitOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  throwOnError?: boolean;
  stdin?: string;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function spawnGit(
  args: string[],
  opts: SpawnGitOptions
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf-8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const result: GitResult = { code: code ?? -1, stdout, stderr };
      if (opts.throwOnError && result.code !== 0) {
        reject(
          new Error(
            `git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr || result.stdout}`
          )
        );
        return;
      }
      resolve(result);
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}
