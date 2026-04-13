import { describe, it, expect } from 'vitest';
import { resolveWorkflows } from '../../src/federation/workflows.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import type { Edge } from '../../src/graph/types.js';

function fp(
  name: string,
  workflows_declared?: Array<{ name: string; entry_point?: boolean }>
): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: { languages: [] },
    exposes: [],
    consumes: [],
    workflows_declared,
  };
}

function edge(id: string, from: string, to: string): Edge {
  return {
    id,
    from,
    to,
    type: 'kafka',
    bidirectional: false,
    details: {},
    evidence: {},
    confidence: 'static',
    discovered_at: '2026-04-13T10:00:00Z',
    workflows: [],
  };
}

describe('resolveWorkflows', () => {
  it('returns empty when no workflows declared', () => {
    const result = resolveWorkflows([fp('svc-a'), fp('svc-b')], []);
    expect(result).toEqual([]);
  });

  it('builds a workflow from one declared entry point, chained edges', () => {
    const fps = [
      fp('svc-a', [{ name: 'order-placement', entry_point: true }]),
      fp('svc-b'),
      fp('svc-c'),
    ];
    const edges = [
      edge('e1', 'svc-a', 'svc-b'),
      edge('e2', 'svc-b', 'svc-c'),
    ];
    const result = resolveWorkflows(fps, edges);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('order-placement');
    expect(result[0].entry_points).toEqual(['svc-a']);
    expect(result[0].services.sort()).toEqual(
      ['svc-a', 'svc-b', 'svc-c'].sort()
    );
    expect(result[0].edges.sort()).toEqual(['e1', 'e2']);
  });

  it('merges multiple entry points for the same workflow name', () => {
    const fps = [
      fp('svc-a', [{ name: 'flow', entry_point: true }]),
      fp('svc-x', [{ name: 'flow', entry_point: true }]),
      fp('svc-b'),
    ];
    const edges = [
      edge('e1', 'svc-a', 'svc-b'),
      edge('e2', 'svc-x', 'svc-b'),
    ];
    const result = resolveWorkflows(fps, edges);
    expect(result).toHaveLength(1);
    expect(result[0].entry_points.sort()).toEqual(['svc-a', 'svc-x']);
    expect(result[0].services.sort()).toEqual(
      ['svc-a', 'svc-b', 'svc-x'].sort()
    );
  });

  it('does not include services unreachable from the entry points', () => {
    const fps = [
      fp('svc-a', [{ name: 'flow', entry_point: true }]),
      fp('svc-b'),
      fp('svc-lonely'),
    ];
    const edges = [edge('e1', 'svc-a', 'svc-b')];
    const result = resolveWorkflows(fps, edges);
    expect(result[0].services).not.toContain('svc-lonely');
  });
});
