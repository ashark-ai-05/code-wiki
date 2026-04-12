import path from 'node:path';
import type { AdapterRegistry } from '../adapters/registry.js';
import type {
  LanguageDetection,
  CommunicationDetection,
} from '../adapters/types.js';
import type { RepoFingerprint } from './types.js';
import { discoverRepos } from './repo-walker.js';

export async function fingerprintRepo(
  repoPath: string,
  registry: AdapterRegistry
): Promise<RepoFingerprint> {
  const repoName = path.basename(repoPath);
  const languages: RepoFingerprint['tech_stack']['languages'] = [];
  const communication: RepoFingerprint['communication'] = [];

  for (const adapter of registry.getByType('language')) {
    const result = await adapter.detect(repoPath);
    if (result.detected) {
      const langResult = result as LanguageDetection;
      languages.push({
        language: langResult.details.language,
        version: langResult.details.version,
        build_tool: langResult.details.build_tool,
        dependencies: langResult.details.dependencies,
      });
    }
  }

  for (const adapter of registry.getByType('communication')) {
    const result = await adapter.detect(repoPath);
    if (result.detected) {
      const commResult = result as CommunicationDetection;
      communication.push({
        type: commResult.details.type,
        role: commResult.details.role,
        identifiers: commResult.details.identifiers,
        config_files: commResult.details.config_files,
      });
    }
  }

  return {
    repo_path: repoPath,
    repo_name: repoName,
    tech_stack: { languages },
    communication,
    scanned_at: new Date().toISOString(),
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
