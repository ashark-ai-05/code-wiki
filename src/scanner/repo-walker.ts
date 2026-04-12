import { readdirSync } from 'node:fs';
import path from 'node:path';

export function discoverRepos(parentDir: string): string[] {
  const entries = readdirSync(parentDir, { withFileTypes: true });
  const repos: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules')
      continue;

    const fullPath = path.join(parentDir, entry.name);
    if (isRepo(fullPath)) {
      repos.push(fullPath);
    }
  }

  return repos;
}

function isRepo(dirPath: string): boolean {
  const markers = [
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
  const entries = readdirSync(dirPath);
  return markers.some((marker) => entries.includes(marker));
}
