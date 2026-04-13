import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitFederationClient } from '../../src/federation/git-client.js';
import { spawnGit } from '../../src/federation/git.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function makeBareRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await spawnGit(['init', '--bare', '--initial-branch=main'], {
    cwd: dir,
    throwOnError: true,
  });
}

async function seedInitialCommit(
  bareUrl: string,
  workDir: string
): Promise<void> {
  mkdirSync(workDir, { recursive: true });
  await spawnGit(['clone', bareUrl, '.'], { cwd: workDir, throwOnError: true });
  writeFileSync(path.join(workDir, 'README.md'), '# federation\n');
  await spawnGit(['add', '.'], { cwd: workDir, throwOnError: true });
  await spawnGit(
    ['-c', 'user.email=ci@code-wiki', '-c', 'user.name=ci', 'commit', '-m', 'init'],
    { cwd: workDir, throwOnError: true }
  );
  await spawnGit(['push', 'origin', 'main'], {
    cwd: workDir,
    throwOnError: true,
  });
}

describe('GitFederationClient', () => {
  let tmp: string;
  let bareDir: string;
  let bareUrl: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-gitclient-'));
    bareDir = path.join(tmp, 'bare.git');
    bareUrl = `file://${bareDir}`;
    await makeBareRepo(bareDir);
    await seedInitialCommit(bareUrl, path.join(tmp, 'seed'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ensureClone clones when local dir is empty', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);
    expect(existsSync(path.join(local, 'README.md'))).toBe(true);
  });

  it('ensureClone is idempotent: second call is a pull', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);
    await client.ensureClone(local);
    expect(existsSync(path.join(local, 'README.md'))).toBe(true);
  });

  it('commitAndPush with publish_strategy=direct pushes to main', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    writeFileSync(path.join(local, 'hello.txt'), 'hi\n');

    const result = await client.commitAndPush(local, 'add hello.txt');
    expect(result.pushed).toBe(true);
    expect(result.branch).toBe('main');

    const verify = path.join(tmp, 'verify');
    mkdirSync(verify, { recursive: true });
    await spawnGit(['clone', bareUrl, '.'], {
      cwd: verify,
      throwOnError: true,
    });
    expect(
      readFileSync(path.join(verify, 'hello.txt'), 'utf-8').trim()
    ).toBe('hi');
  });

  it('commitAndPush with publish_strategy=branch pushes a fingerprint branch', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'branch',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    writeFileSync(path.join(local, 'fingerprints.txt'), 'content\n');
    const result = await client.commitAndPush(
      local,
      'publish fingerprint for svc-a',
      'fingerprint/svc-a-abc123'
    );
    expect(result.pushed).toBe(true);
    expect(result.branch).toBe('fingerprint/svc-a-abc123');

    const lsRemote = await spawnGit(['ls-remote', bareUrl], {
      cwd: tmp,
      throwOnError: true,
    });
    expect(lsRemote.stdout).toContain('refs/heads/fingerprint/svc-a-abc123');
  });

  it('commitAndPush with no changes returns pushed=false', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    const result = await client.commitAndPush(local, 'no changes');
    expect(result.pushed).toBe(false);
  });
}, 30000);
