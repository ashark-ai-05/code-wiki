import { readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_MARKERS = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  '.git',
  'Dockerfile',
];

/**
 * Discover repos from a scan path.
 *
 * - If the path itself has repo markers (go.mod, package.json, etc.), it is
 *   included as a repo. This handles standalone repos and monorepo roots.
 * - Immediate child directories with markers are also included. This handles
 *   parent-of-repos directories and monorepos with sub-packages.
 */
export function discoverRepos(scanPath: string): string[] {
  const repos: string[] = [];

  if (isRepo(scanPath)) {
    repos.push(scanPath);
  }

  const entries = readdirSync(scanPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules')
      continue;

    const fullPath = path.join(scanPath, entry.name);
    if (isRepo(fullPath)) {
      repos.push(fullPath);
    }
  }

  return repos;
}

function isRepo(dirPath: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return false;
  }
  return REPO_MARKERS.some((marker) => entries.includes(marker));
}
