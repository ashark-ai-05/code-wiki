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

describe('writeGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(
      path.join(os.tmpdir(), 'code-wiki-test-')
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes services.json and edges.json', () => {
    const graph: Graph = {
      schema_version: '1.0',
      services: [
        {
          id: 'svc-a',
          repo: '/repos/svc-a',
          type: 'microservice',
          tech_stack: {
            languages: ['java:17'],
            frameworks: [],
            build: ['gradle'],
            runtime: [],
            databases: [],
          },
          exposes: [],
          consumes: [],
          last_scanned: '2026-04-12T10:00:00Z',
        },
      ],
      edges: [
        {
          id: 'e001',
          from: 'svc-a',
          to: 'svc-b',
          type: 'kafka',
          bidirectional: false,
          details: { topic: 'test.topic' },
          evidence: {},
          confidence: 'static',
          discovered_at: '2026-04-12T10:00:00Z',
          workflows: [],
        },
      ],
    };

    writeGraph(graph, tmpDir);

    const servicesPath = path.join(tmpDir, 'graph', 'services.json');
    const edgesPath = path.join(tmpDir, 'graph', 'edges.json');

    expect(existsSync(servicesPath)).toBe(true);
    expect(existsSync(edgesPath)).toBe(true);

    const services = JSON.parse(
      readFileSync(servicesPath, 'utf-8')
    );
    expect(services.schema_version).toBe('1.0');
    expect(services.services).toHaveLength(1);

    const edges = JSON.parse(readFileSync(edgesPath, 'utf-8'));
    expect(edges.edges).toHaveLength(1);
    expect(edges.edges[0].from).toBe('svc-a');
  });

  it('writes tech-matrix.json', () => {
    const graph: Graph = {
      schema_version: '1.0',
      services: [
        {
          id: 'svc-a',
          repo: '',
          type: 'microservice',
          tech_stack: {
            languages: ['java:17'],
            frameworks: ['spring-boot'],
            build: ['gradle'],
            runtime: [],
            databases: [],
          },
          exposes: [],
          consumes: [],
          last_scanned: '',
        },
        {
          id: 'svc-b',
          repo: '',
          type: 'microservice',
          tech_stack: {
            languages: ['typescript:5.4'],
            frameworks: ['express'],
            build: ['npm'],
            runtime: [],
            databases: [],
          },
          exposes: [],
          consumes: [],
          last_scanned: '',
        },
      ],
      edges: [],
    };

    writeGraph(graph, tmpDir);

    const matrixPath = path.join(
      tmpDir, 'graph', 'tech-matrix.json'
    );
    expect(existsSync(matrixPath)).toBe(true);

    const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8'));
    expect(matrix.languages['java:17']).toContain('svc-a');
    expect(matrix.languages['typescript:5.4']).toContain('svc-b');
  });
});
