import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import type { RepoFingerprint, Exposure } from '../../src/fingerprint/types.js';

function makeFp(overrides: {
  repo_name: string;
  exposes?: Exposure[];
  consumes?: Exposure[];
  language?: string;
  version?: string;
  build_tool?: string;
}): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: {
      name: overrides.repo_name,
      path: `/repos/${overrides.repo_name}`,
    },
    scanned_at: '2026-04-12T10:00:00Z',
    tech_stack: {
      languages: overrides.language
        ? [
            {
              language: overrides.language,
              version: overrides.version,
              build_tool: overrides.build_tool,
            },
          ]
        : [],
    },
    exposes: overrides.exposes ?? [],
    consumes: overrides.consumes ?? [],
  };
}

function kafka(
  identifier: string,
  role: Exposure['role']
): Exposure {
  return {
    type: 'kafka-topic',
    identifier,
    role,
    source: { path: 'app.yaml', line: 1 },
    detection_method: 'static',
    confidence: 'static',
  };
}

describe('buildGraph', () => {
  it('creates service nodes with language:version labels', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'credit-gateway',
        language: 'java',
        version: '17',
        build_tool: 'gradle',
      }),
      makeFp({
        repo_name: 'pricing-engine',
        language: 'typescript',
        version: '5.4',
        build_tool: 'npm',
      }),
    ]);
    expect(graph.schema_version).toBe('2.0');
    expect(graph.services).toHaveLength(2);
    expect(graph.services[0].tech_stack.languages).toContain('java:17');
    expect(graph.services[1].tech_stack.languages).toContain(
      'typescript:5.4'
    );
  });

  it('creates edges by matching kafka-topic exposes to consumes', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'credit-gateway',
        exposes: [kafka('credit.check.requests', 'producer')],
      }),
      makeFp({
        repo_name: 'risk-calc',
        consumes: [kafka('credit.check.requests', 'consumer')],
      }),
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('credit-gateway');
    expect(graph.edges[0].to).toBe('risk-calc');
    expect(graph.edges[0].type).toBe('kafka');
    expect(graph.edges[0].details.topic).toBe('credit.check.requests');
  });

  it('matches kafka topics across environment prefixes and versions', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'svc-a',
        exposes: [kafka('prod.orders.new.v1', 'producer')],
      }),
      makeFp({
        repo_name: 'svc-b',
        consumes: [kafka('dev.orders.new.v2', 'consumer')],
      }),
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('svc-a');
    expect(graph.edges[0].to).toBe('svc-b');
  });

  it('handles bidirectional topics (both-role in both services)', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'svc-a',
        exposes: [kafka('topic.x', 'both')],
        consumes: [kafka('topic.x', 'both')],
      }),
      makeFp({
        repo_name: 'svc-b',
        exposes: [kafka('topic.x', 'both')],
        consumes: [kafka('topic.x', 'both')],
      }),
    ]);
    // Each service both produces and consumes — expect at least a→b and b→a.
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty edges when no topics match', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'svc-a',
        exposes: [kafka('topic.a', 'producer')],
      }),
      makeFp({
        repo_name: 'svc-b',
        exposes: [kafka('topic.b', 'producer')],
      }),
    ]);
    expect(graph.edges).toHaveLength(0);
  });

  it('edge evidence points back to source file:line', () => {
    const graph = buildGraph([
      makeFp({
        repo_name: 'svc-a',
        exposes: [
          {
            ...kafka('topic.x', 'producer'),
            source: { path: 'producer.yaml', line: 12 },
          },
        ],
      }),
      makeFp({
        repo_name: 'svc-b',
        consumes: [
          {
            ...kafka('topic.x', 'consumer'),
            source: { path: 'consumer.yaml', line: 34 },
          },
        ],
      }),
    ]);
    expect(graph.edges[0].evidence.from_file).toBe('producer.yaml');
    expect(graph.edges[0].evidence.from_line).toBe(12);
    expect(graph.edges[0].evidence.to_file).toBe('consumer.yaml');
    expect(graph.edges[0].evidence.to_line).toBe(34);
  });
});
