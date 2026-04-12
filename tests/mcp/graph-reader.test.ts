import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphReader } from '../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sampleServices() {
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
      {
        id: 'svc-b',
        repo: '/repos/svc-b',
        type: 'microservice',
        tech_stack: {
          languages: ['go:1.22'],
          frameworks: [],
          build: ['go'],
          runtime: [],
          databases: [],
        },
        exposes: [],
        consumes: [
          {
            type: 'kafka-topic',
            identifier: 'orders.new',
            role: 'consumer',
            source: { path: 'main.go', line: 42 },
            detection_method: 'static',
            confidence: 'static',
          },
        ],
        last_scanned: '2026-04-12T10:00:00Z',
      },
    ],
  };
}

function sampleEdges() {
  return {
    schema_version: '2.0',
    edges: [
      {
        id: 'e001',
        from: 'svc-a',
        to: 'svc-b',
        type: 'kafka',
        bidirectional: false,
        details: { topic: 'orders.new' },
        evidence: {
          from_file: 'app.yaml',
          from_line: 1,
          to_file: 'main.go',
          to_line: 42,
        },
        confidence: 'static',
        discovered_at: '2026-04-12T10:00:00Z',
        workflows: [],
      },
    ],
  };
}

function sampleMatrix() {
  return {
    languages: { 'java:17': ['svc-a'], 'go:1.22': ['svc-b'] },
    frameworks: { 'spring-boot': ['svc-a'] },
    build: { gradle: ['svc-a'], go: ['svc-b'] },
  };
}

describe('GraphReader', () => {
  let tmp: string;
  let graphDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-reader-'));
    graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify(sampleServices())
    );
    writeFileSync(
      path.join(graphDir, 'edges.json'),
      JSON.stringify(sampleEdges())
    );
    writeFileSync(
      path.join(graphDir, 'tech-matrix.json'),
      JSON.stringify(sampleMatrix())
    );
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads all three graph files on construction', () => {
    const reader = new GraphReader(graphDir);
    expect(reader.services()).toHaveLength(2);
    expect(reader.edges()).toHaveLength(1);
    expect(reader.techMatrix().languages['java:17']).toContain('svc-a');
  });

  it('getServiceById returns the right service', () => {
    const reader = new GraphReader(graphDir);
    expect(reader.getServiceById('svc-a')!.id).toBe('svc-a');
    expect(reader.getServiceById('nonexistent')).toBeUndefined();
  });

  it('refresh() re-reads files from disk', () => {
    const reader = new GraphReader(graphDir);
    expect(reader.services()).toHaveLength(2);

    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({ schema_version: '2.0', services: [] })
    );

    reader.refresh();
    expect(reader.services()).toHaveLength(0);
  });

  it('freshness() returns seconds since services.json mtime', () => {
    const reader = new GraphReader(graphDir);
    const age = reader.freshnessSeconds();
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(10);
  });

  it('sourcesMeta() returns graph_path and loaded_at', () => {
    const reader = new GraphReader(graphDir);
    const meta = reader.sourcesMeta();
    expect(meta.graph_path).toBe(graphDir);
    expect(typeof meta.graph_loaded_at).toBe('string');
    expect(typeof meta.graph_freshness_seconds).toBe('number');
  });

  it('throws a clear error when services.json is missing', () => {
    rmSync(path.join(graphDir, 'services.json'));
    expect(() => new GraphReader(graphDir)).toThrow(/services\.json/);
  });

  it('tolerates missing optional files (edges, matrix)', () => {
    rmSync(path.join(graphDir, 'edges.json'));
    rmSync(path.join(graphDir, 'tech-matrix.json'));
    const reader = new GraphReader(graphDir);
    expect(reader.edges()).toEqual([]);
    expect(reader.techMatrix()).toEqual({
      languages: {},
      frameworks: {},
      build: {},
    });
  });
});
