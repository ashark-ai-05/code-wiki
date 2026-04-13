import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RepoFingerprint } from '../fingerprint/types.js';
import { isValidFingerprint } from '../fingerprint/schema.js';

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function fingerprintFilename(fp: RepoFingerprint): string {
  if (!SAFE_NAME.test(fp.repo.name)) {
    throw new Error(
      `Invalid repo name for fingerprint filename: "${fp.repo.name}". Must match ${SAFE_NAME}.`
    );
  }
  return `${fp.repo.name}.json`;
}

export function writeFingerprint(
  dir: string,
  fp: RepoFingerprint
): string {
  const filename = fingerprintFilename(fp);
  const target = path.join(dir, filename);
  writeFileSync(target, JSON.stringify(fp, null, 2), 'utf-8');
  return target;
}

export function readFingerprint(filePath: string): RepoFingerprint {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (!isValidFingerprint(raw)) {
    throw new Error(`Invalid fingerprint schema: ${filePath}`);
  }
  return raw;
}
