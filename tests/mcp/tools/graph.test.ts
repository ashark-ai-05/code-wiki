import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool,
} from '../../../src/mcp/tools/graph.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function writeSampleGraph(graphDir: string): void {
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(
    path.join(graphDir, 'services.json'),
    JSON.stringify({
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
          exposes: [],
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
          consumes: [],
          last_scanned: '2026-04-12T10:00:00Z',
        },
      ],
    })
  );
  writeFileSync(
    path.join(graphDir, 'edges.json'),
    JSON.stringify({
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
    })
  );
  writeFileSync(
    path.join(graphDir, 'tech-matrix.json'),
    JSON.stringify({
      languages: { 'java:17': ['svc-a'], 'go:1.22': ['svc-b'] },
      frameworks: { 'spring-boot': ['svc-a'] },
      build: { gradle: ['svc-a'], go: ['svc-b'] },
    })
  );
}

describe('graph tools', () => {
  let tmp: string;
  let reader: GraphReader;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-graph-'));
    const graphDir = path.join(tmp, 'graph');
    writeSampleGraph(graphDir);
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('list_services returns all services', async () => {
    const res = await listServicesTool.handler({}, { reader, cwd: tmp });
    const data = res.data as { services: Array<{ id: string }> };
    expect(data.services).toHaveLength(2);
    expect(data.services.map((s) => s.id).sort()).toEqual([
      'svc-a',
      'svc-b',
    ]);
    expect(res.sources?.graph_path).toContain('graph');
  });

  it('list_services filters by language', async () => {
    const res = await listServicesTool.handler(
      { language: 'java' },
      { reader, cwd: tmp }
    );
    const data = res.data as { services: Array<{ id: string }> };
    expect(data.services).toHaveLength(1);
    expect(data.services[0].id).toBe('svc-a');
  });

  it('get_service returns the full service by id', async () => {
    const res = await getServiceTool.handler(
      { id: 'svc-a' },
      { reader, cwd: tmp }
    );
    const data = res.data as { service: { id: string } | null };
    expect(data.service).not.toBeNull();
    expect(data.service!.id).toBe('svc-a');
  });

  it('get_service returns null for unknown id', async () => {
    const res = await getServiceTool.handler(
      { id: 'nope' },
      { reader, cwd: tmp }
    );
    const data = res.data as { service: unknown };
    expect(data.service).toBeNull();
  });

  it('find_by_tech finds services by language', async () => {
    const res = await findByTechTool.handler(
      { category: 'languages', value: 'java:17' },
      { reader, cwd: tmp }
    );
    const data = res.data as { services: string[] };
    expect(data.services).toEqual(['svc-a']);
  });

  it('find_by_tech finds services by framework', async () => {
    const res = await findByTechTool.handler(
      { category: 'frameworks', value: 'spring-boot' },
      { reader, cwd: tmp }
    );
    const data = res.data as { services: string[] };
    expect(data.services).toEqual(['svc-a']);
  });

  it('find_by_tech returns empty for unknown category/value', async () => {
    const res = await findByTechTool.handler(
      { category: 'languages', value: 'ruby' },
      { reader, cwd: tmp }
    );
    const data = res.data as { services: string[] };
    expect(data.services).toEqual([]);
  });

  it('trace_downstream follows outgoing edges one level', async () => {
    const res = await traceDownstreamTool.handler(
      { service_id: 'svc-a', depth: 1 },
      { reader, cwd: tmp }
    );
    const data = res.data as {
      from: string;
      reached: string[];
    };
    expect(data.from).toBe('svc-a');
    expect(data.reached).toEqual(['svc-b']);
  });

  it('trace_upstream follows incoming edges', async () => {
    const res = await traceUpstreamTool.handler(
      { service_id: 'svc-b' },
      { reader, cwd: tmp }
    );
    const data = res.data as { reached: string[] };
    expect(data.reached).toEqual(['svc-a']);
  });

  it('get_edges returns all edges when no filter', async () => {
    const res = await getEdgesTool.handler({}, { reader, cwd: tmp });
    const data = res.data as { edges: Array<{ id: string }> };
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].id).toBe('e001');
  });

  it('get_edges filters by type', async () => {
    const res = await getEdgesTool.handler(
      { type: 'kafka' },
      { reader, cwd: tmp }
    );
    const data = res.data as { edges: unknown[] };
    expect(data.edges).toHaveLength(1);
  });

  it('get_edges returns empty when type does not match', async () => {
    const res = await getEdgesTool.handler(
      { type: 'rest' },
      { reader, cwd: tmp }
    );
    const data = res.data as { edges: unknown[] };
    expect(data.edges).toHaveLength(0);
  });

  it('trace_downstream supports edge_types filter', async () => {
    const res = await traceDownstreamTool.handler(
      { service_id: 'svc-a', edge_types: ['rest'] },
      { reader, cwd: tmp }
    );
    const data = res.data as { reached: string[] };
    expect(data.reached).toEqual([]);
  });
});
