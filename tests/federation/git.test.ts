import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnGit } from '../../src/federation/git.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('spawnGit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-git-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runs `git init` and captures stdout', async () => {
    const result = await spawnGit(['init'], { cwd: tmp });
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toMatch(/initialized|reinitialized/);
  });

  it('returns non-zero exit code for invalid command', async () => {
    const result = await spawnGit(['this-is-not-a-real-subcommand'], {
      cwd: tmp,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('passes args as argv (no shell interpolation)', async () => {
    // Use `git log` in a non-git dir: always exits non-zero regardless of
    // extra args, and if shell were invoked the `; echo hacked` would execute.
    const result = await spawnGit(
      ['log', '; echo hacked'],
      { cwd: tmp, throwOnError: false }
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toContain('hacked');
    expect(result.stdout).not.toContain('hacked');
  });

  it('throwOnError=true throws on non-zero exit', async () => {
    await expect(
      spawnGit(['fetch', 'nope-nonexistent-remote'], {
        cwd: tmp,
        throwOnError: true,
      })
    ).rejects.toThrow(/git/i);
  });
});
