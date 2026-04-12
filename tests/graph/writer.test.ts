import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeGraph } from '../../src/graph/writer.js';
import type { Graph } from '../../src/graph/types.js';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sampleGraph(): Graph {
  return {
    schema_version: '2.0',
    services: [
      {
        id: 'svc-a',
        repo: '/repos/svc-a',
        type: 'microservice',
        tech_stack: {
          languages: ['java:17'],
          frameworks: ['spring-boot'],
          build: ['gradle'],
          runtime: [],
          databases: [],
        },
        exposes: [
          {
            type: 'kafka-topic',
            identifier: 'orders.new',
            role: 'producer',
            source: { path: 'app.yaml', line: 1 },
            detection_method: 'static',
            confidence: 'static',
          },
        ],
        consumes: [],
        last_scanned: '2026-04-12T10:00:00Z',
      },
    ],
    edges: [],
  };
}

describe('writeGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'code-wiki-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes services.json with schema_version 2.0', () => {
    writeGraph(sampleGraph(), tmpDir);
    const services = JSON.parse(
      readFileSync(path.join(tmpDir, 'graph', 'services.json'), 'utf-8')
    );
    expect(services.schema_version).toBe('2.0');
    expect(services.services[0].exposes[0].identifier).toBe('orders.new');
    expect(services.services[0].exposes[0].source.path).toBe('app.yaml');
  });

  it('writes edges.json', () => {
    writeGraph(sampleGraph(), tmpDir);
    expect(
      existsSync(path.join(tmpDir, 'graph', 'edges.json'))
    ).toBe(true);
  });

  it('writes tech-matrix.json grouped by language/framework/build', () => {
    writeGraph(sampleGraph(), tmpDir);
    const matrix = JSON.parse(
      readFileSync(path.join(tmpDir, 'graph', 'tech-matrix.json'), 'utf-8')
    );
    expect(matrix.languages['java:17']).toContain('svc-a');
    expect(matrix.frameworks['spring-boot']).toContain('svc-a');
    expect(matrix.build['gradle']).toContain('svc-a');
  });
});
