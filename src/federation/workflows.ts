import type { RepoFingerprint } from '../fingerprint/types.js';
import type { Edge } from '../graph/types.js';

export interface ResolvedWorkflow {
  name: string;
  entry_points: string[];
  services: string[];
  edges: string[];
}

export function resolveWorkflows(
  fingerprints: RepoFingerprint[],
  edges: Edge[]
): ResolvedWorkflow[] {
  const entryPoints = new Map<string, Set<string>>();
  for (const fp of fingerprints) {
    for (const declared of fp.workflows_declared ?? []) {
      if (!declared.entry_point) continue;
      const set = entryPoints.get(declared.name) ?? new Set<string>();
      set.add(fp.repo.name);
      entryPoints.set(declared.name, set);
    }
  }

  const result: ResolvedWorkflow[] = [];
  for (const [name, eps] of entryPoints) {
    const reachable = bfsFromEntries(edges, [...eps]);
    const edgeIds: string[] = [];
    for (const edge of edges) {
      if (reachable.has(edge.from) && reachable.has(edge.to)) {
        edgeIds.push(edge.id);
      }
    }
    result.push({
      name,
      entry_points: [...eps].sort(),
      services: [...reachable].sort(),
      edges: edgeIds.sort(),
    });
  }
  return result;
}

function bfsFromEntries(edges: Edge[], starts: string[]): Set<string> {
  const reachable = new Set<string>(starts);
  let frontier = [...starts];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of edges) {
        if (edge.from === node && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }
  return reachable;
}
