import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import type { FederationConfig } from './types.js';
import { GitFederationClient } from './git-client.js';

export interface PullOptions {
  config: FederationConfig;
  localDir?: string;
}

export interface PullResult {
  localDir: string;
}

export async function pullFederation(
  opts: PullOptions
): Promise<PullResult> {
  const localDir =
    opts.localDir ?? path.join(os.homedir(), '.code-wiki', 'org');
  mkdirSync(path.dirname(localDir), { recursive: true });

  const client = new GitFederationClient(opts.config);
  await client.ensureClone(localDir);
  return { localDir };
}
