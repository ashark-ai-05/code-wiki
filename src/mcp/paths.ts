import { existsSync } from 'node:fs';
import path from 'node:path';

export interface DiscoverOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

/**
 * Resolve the directory holding services.json / edges.json / tech-matrix.json.
 *
 * Priority:
 *   1. $CODE_WIKI_GRAPH
 *   2. <cwd>/docs/wiki/graph/
 *   3. <cwd>/code-wiki-output/graph/
 *
 * Returns null when none of the above contains a services.json.
 */
export function discoverGraphPath(opts: DiscoverOptions): string | null {
  const candidates: string[] = [];

  const envOverride = opts.env.CODE_WIKI_GRAPH;
  if (envOverride) candidates.push(envOverride);

  candidates.push(path.join(opts.cwd, 'docs', 'wiki', 'graph'));
  candidates.push(path.join(opts.cwd, 'code-wiki-output', 'graph'));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'services.json'))) {
      return candidate;
    }
  }
  return null;
}
