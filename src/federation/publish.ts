import path from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import type { RepoFingerprint } from '../fingerprint/types.js';
import type { FederationConfig } from './types.js';
import { GitFederationClient } from './git-client.js';
import { writeFingerprint } from './fingerprint-io.js';

export interface PublishOptions {
  fingerprint: RepoFingerprint;
  config: FederationConfig;
  commitSha?: string;
}

export interface PublishResult {
  pushed: boolean;
  branch: string;
  fingerprint_file: string;
}

export async function publishFingerprint(
  opts: PublishOptions
): Promise<PublishResult> {
  const client = new GitFederationClient(opts.config);
  const workTree = mkdtempSync(path.join(os.tmpdir(), 'code-wiki-publish-'));
  await client.ensureClone(workTree);

  const fpDir = path.join(workTree, 'fingerprints');
  mkdirSync(fpDir, { recursive: true });
  const target = writeFingerprint(fpDir, opts.fingerprint);

  const message = `publish fingerprint for ${opts.fingerprint.repo.name}`;
  const branch =
    opts.config.publish_strategy === 'branch'
      ? `fingerprint/${opts.fingerprint.repo.name}-${opts.commitSha ?? Date.now()}`
      : undefined;
  const result = await client.commitAndPush(workTree, message, branch);

  return {
    pushed: result.pushed,
    branch: result.branch,
    fingerprint_file: path.relative(workTree, target),
  };
}
