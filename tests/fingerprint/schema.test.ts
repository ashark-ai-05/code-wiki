import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, isValidFingerprint } from '../../src/fingerprint/schema.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';

describe('fingerprint schema', () => {
  it('SCHEMA_VERSION is "2.0"', () => {
    expect(SCHEMA_VERSION).toBe('2.0');
  });

  it('isValidFingerprint accepts a well-formed v2.0 fingerprint', () => {
    const fp: RepoFingerprint = {
      schema_version: '2.0',
      repo: { name: 'svc-a', path: '/repos/svc-a' },
      scanned_at: '2026-04-12T10:00:00Z',
      tech_stack: { languages: [{ language: 'go', version: '1.22' }] },
      exposes: [],
      consumes: [],
    };
    expect(isValidFingerprint(fp)).toBe(true);
  });

  it('isValidFingerprint rejects missing schema_version', () => {
    expect(isValidFingerprint({} as unknown)).toBe(false);
  });

  it('isValidFingerprint rejects wrong schema_version', () => {
    expect(
      isValidFingerprint({
        schema_version: '1.0',
        repo: { name: 'x', path: '/x' },
        scanned_at: '',
        tech_stack: { languages: [] },
        exposes: [],
        consumes: [],
      } as unknown)
    ).toBe(false);
  });

  it('isValidFingerprint rejects missing exposes/consumes arrays', () => {
    expect(
      isValidFingerprint({
        schema_version: '2.0',
        repo: { name: 'x', path: '/x' },
        scanned_at: '',
        tech_stack: { languages: [] },
      } as unknown)
    ).toBe(false);
  });
});
