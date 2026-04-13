import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFingerprint,
  readFingerprint,
  fingerprintFilename,
} from '../../src/federation/fingerprint-io.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sampleFingerprint(): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name: 'svc-a', path: '/repos/svc-a' },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'java', version: '17', build_tool: 'gradle' }],
    },
    exposes: [],
    consumes: [],
  };
}

describe('fingerprint I/O', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-fpio-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('fingerprintFilename matches repo name', () => {
    const fp = sampleFingerprint();
    expect(fingerprintFilename(fp)).toBe('svc-a.json');
  });

  it('round-trips a fingerprint', () => {
    const fp = sampleFingerprint();
    writeFingerprint(tmp, fp);
    const loaded = readFingerprint(path.join(tmp, 'svc-a.json'));
    expect(loaded.repo.name).toBe('svc-a');
    expect(loaded.schema_version).toBe('2.0');
  });

  it('writeFingerprint emits pretty JSON', () => {
    writeFingerprint(tmp, sampleFingerprint());
    const raw = readFileSync(path.join(tmp, 'svc-a.json'), 'utf-8');
    expect(raw).toContain('\n  ');
  });

  it('readFingerprint rejects invalid schema', () => {
    const badPath = path.join(tmp, 'bad.json');
    writeFileSync(badPath, JSON.stringify({ schema_version: '1.0' }));
    expect(() => readFingerprint(badPath)).toThrow(/schema/i);
  });

  it('rejects repo names containing path separators', () => {
    const evil: RepoFingerprint = {
      ...sampleFingerprint(),
      repo: { name: '../../../etc/passwd', path: '/x' },
    };
    expect(() => writeFingerprint(tmp, evil)).toThrow(/invalid/i);
  });
});
