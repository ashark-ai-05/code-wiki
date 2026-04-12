import path from 'node:path';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { LanguageDetection } from '../adapters/types.js';
import type { Exposure, RepoFingerprint } from '../fingerprint/types.js';
import { SCHEMA_VERSION } from '../fingerprint/schema.js';
import { discoverRepos } from './repo-walker.js';

export async function fingerprintRepo(
  repoPath: string,
  registry: AdapterRegistry
): Promise<RepoFingerprint> {
  const repoName = path.basename(repoPath);
  const languages: RepoFingerprint['tech_stack']['languages'] = [];
  const exposures: Exposure[] = [];

  for (const adapter of registry.getByType('language')) {
    const result = await adapter.detect(repoPath);
    if (result.detected) {
      const lang = result as LanguageDetection;
      languages.push({
        language: lang.details.language,
        version: lang.details.version,
        build_tool: lang.details.build_tool,
        dependencies: lang.details.dependencies,
      });
    }
  }

  for (const adapter of registry.getByType('communication')) {
    if (typeof adapter.findExposures === 'function') {
      const found = await adapter.findExposures(repoPath);
      exposures.push(...found);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    repo: { name: repoName, path: repoPath },
    scanned_at: new Date().toISOString(),
    tech_stack: { languages },
    exposes: exposures.filter((e) =>
      ['producer', 'server', 'both'].includes(e.role)
    ),
    consumes: exposures.filter((e) =>
      ['consumer', 'client', 'both'].includes(e.role)
    ),
  };
}

export async function fingerprint(
  parentDir: string,
  registry: AdapterRegistry
): Promise<RepoFingerprint[]> {
  const repoPaths = discoverRepos(parentDir);
  const results: RepoFingerprint[] = [];

  for (const repoPath of repoPaths) {
    const result = await fingerprintRepo(repoPath, registry);
    results.push(result);
  }
  return results;
}
