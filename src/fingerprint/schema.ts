import type { RepoFingerprint } from './types.js';

export const SCHEMA_VERSION = '2.0' as const;

export function isValidFingerprint(
  value: unknown
): value is RepoFingerprint {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schema_version !== SCHEMA_VERSION) return false;
  if (!v.repo || typeof v.repo !== 'object') return false;
  const repo = v.repo as Record<string, unknown>;
  if (typeof repo.name !== 'string' || typeof repo.path !== 'string') {
    return false;
  }
  if (typeof v.scanned_at !== 'string') return false;
  if (!v.tech_stack || typeof v.tech_stack !== 'object') return false;
  if (!Array.isArray((v.tech_stack as { languages?: unknown }).languages)) {
    return false;
  }
  if (!Array.isArray(v.exposes) || !Array.isArray(v.consumes)) {
    return false;
  }
  return true;
}
