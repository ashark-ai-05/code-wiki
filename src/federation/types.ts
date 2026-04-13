import type { FederationConfig } from '../config/schema.js';
export type { FederationConfig };

export interface FederationClient {
  ensureClone(localDir: string): Promise<void>;
  pullLatest(localDir: string): Promise<void>;
  commitAndPush(
    localDir: string,
    message: string,
    branch?: string
  ): Promise<{ pushed: boolean; branch: string }>;
}
