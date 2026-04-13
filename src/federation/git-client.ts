import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnGit } from './git.js';
import type { FederationClient, FederationConfig } from './types.js';

const GIT_AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'code-wiki',
  GIT_AUTHOR_EMAIL: 'code-wiki@local',
  GIT_COMMITTER_NAME: 'code-wiki',
  GIT_COMMITTER_EMAIL: 'code-wiki@local',
};

export class GitFederationClient implements FederationClient {
  constructor(private readonly config: FederationConfig) {}

  async ensureClone(localDir: string): Promise<void> {
    if (existsSync(path.join(localDir, '.git'))) {
      await this.pullLatest(localDir);
      return;
    }
    await spawnGit(
      ['clone', '--branch', this.config.branch, this.config.url, localDir],
      { cwd: path.dirname(localDir), throwOnError: true }
    );
  }

  async pullLatest(localDir: string): Promise<void> {
    await spawnGit(['fetch', 'origin', this.config.branch], {
      cwd: localDir,
      throwOnError: true,
    });
    await spawnGit(['checkout', this.config.branch], {
      cwd: localDir,
      throwOnError: true,
    });
    await spawnGit(['reset', '--hard', `origin/${this.config.branch}`], {
      cwd: localDir,
      throwOnError: true,
    });
  }

  async commitAndPush(
    localDir: string,
    message: string,
    branchOverride?: string
  ): Promise<{ pushed: boolean; branch: string }> {
    const targetBranch =
      branchOverride ??
      (this.config.publish_strategy === 'direct' ? this.config.branch : null);

    if (!targetBranch) {
      throw new Error(
        'commitAndPush: publish_strategy=branch requires a branch name'
      );
    }

    const status = await spawnGit(['status', '--porcelain'], {
      cwd: localDir,
      throwOnError: true,
    });
    if (status.stdout.trim().length === 0) {
      return { pushed: false, branch: targetBranch };
    }

    if (this.config.publish_strategy === 'branch' && branchOverride) {
      await spawnGit(['checkout', '-B', targetBranch], {
        cwd: localDir,
        throwOnError: true,
      });
    }

    await spawnGit(['add', '-A'], { cwd: localDir, throwOnError: true });
    await spawnGit(['commit', '-m', message], {
      cwd: localDir,
      throwOnError: true,
      env: GIT_AUTHOR_ENV,
    });
    await spawnGit(['push', 'origin', targetBranch], {
      cwd: localDir,
      throwOnError: true,
    });
    return { pushed: true, branch: targetBranch };
  }
}
