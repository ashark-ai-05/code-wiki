import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import type { RepoFingerprint } from '../../src/scanner/types.js';

function makeFp(
  overrides: Partial<RepoFingerprint> & { repo_name: string }
): RepoFingerprint {
  return {
    repo_path: `/repos/${overrides.repo_name}`,
    repo_name: overrides.repo_name,
    tech_stack: overrides.tech_stack ?? { languages: [] },
    communication: overrides.communication ?? [],
    scanned_at: '2026-04-12T10:00:00Z',
  };
}

describe('buildGraph', () => {
  it('creates service nodes from fingerprints', () => {
    const fps = [
      makeFp({
        repo_name: 'credit-gateway',
        tech_stack: {
          languages: [
            { language: 'java', version: '17', build_tool: 'gradle' },
          ],
        },
      }),
      makeFp({
        repo_name: 'pricing-engine',
        tech_stack: {
          languages: [
            {
              language: 'typescript',
              version: '5.4',
              build_tool: 'npm',
            },
          ],
        },
      }),
    ];

    const graph = buildGraph(fps);
    expect(graph.services).toHaveLength(2);
    expect(graph.services[0].id).toBe('credit-gateway');
    expect(graph.services[0].tech_stack.languages).toContain(
      'java:17'
    );
    expect(graph.services[1].id).toBe('pricing-engine');
    expect(graph.services[1].tech_stack.languages).toContain(
      'typescript:5.4'
    );
  });

  it('creates edges from matching Kafka topics', () => {
    const fps = [
      makeFp({
        repo_name: 'credit-gateway',
        communication: [
          {
            type: 'kafka',
            role: 'producer',
            identifiers: ['credit.check.requests'],
            config_files: ['app.yaml'],
          },
        ],
      }),
      makeFp({
        repo_name: 'risk-calc',
        communication: [
          {
            type: 'kafka',
            role: 'consumer',
            identifiers: ['credit.check.requests'],
            config_files: ['app.yaml'],
          },
        ],
      }),
    ];

    const graph = buildGraph(fps);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('credit-gateway');
    expect(graph.edges[0].to).toBe('risk-calc');
    expect(graph.edges[0].type).toBe('kafka');
    expect(graph.edges[0].details.topic).toBe(
      'credit.check.requests'
    );
  });

  it('handles bidirectional topics', () => {
    const fps = [
      makeFp({
        repo_name: 'svc-a',
        communication: [
          {
            type: 'kafka',
            role: 'both',
            identifiers: ['topic.x'],
            config_files: [],
          },
        ],
      }),
      makeFp({
        repo_name: 'svc-b',
        communication: [
          {
            type: 'kafka',
            role: 'both',
            identifiers: ['topic.x'],
            config_files: [],
          },
        ],
      }),
    ];

    const graph = buildGraph(fps);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty edges when no topics match', () => {
    const fps = [
      makeFp({
        repo_name: 'svc-a',
        communication: [
          {
            type: 'kafka',
            role: 'producer',
            identifiers: ['topic.a'],
            config_files: [],
          },
        ],
      }),
      makeFp({
        repo_name: 'svc-b',
        communication: [
          {
            type: 'kafka',
            role: 'producer',
            identifiers: ['topic.b'],
            config_files: [],
          },
        ],
      }),
    ];

    const graph = buildGraph(fps);
    expect(graph.edges).toHaveLength(0);
  });
});
