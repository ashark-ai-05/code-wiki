import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  statsTool,
  refreshTool,
  healthTool,
} from '../../../src/mcp/tools/meta.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function writeEmptyGraph(graphDir: string): void {
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(
    path.join(graphDir, 'services.json'),
    JSON.stringify({
      schema_version: '2.0',
      services: [
        {
          id: 'svc-a',
          repo: '/nonexistent/svc-a',
          type: 'microservice',
          tech_stack: {
            languages: [],
            frameworks: [],
            build: [],
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
    JSON.stringify({ schema_version: '2.0', edges: [] })
  );
}

describe('meta tools', () => {
  let tmp: string;
  let reader: GraphReader;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-meta-'));
    const graphDir = path.join(tmp, 'graph');
    writeEmptyGraph(graphDir);
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('stats returns service + edge counts and freshness', async () => {
    const res = await statsTool.handler({}, { reader, cwd: tmp });
    const data = res.data as {
      service_count: number;
      edge_count: number;
      graph_freshness_seconds: number;
    };
    expect(data.service_count).toBe(1);
    expect(data.edge_count).toBe(0);
    expect(data.graph_freshness_seconds).toBeGreaterThanOrEqual(0);
  });

  it('refresh re-reads the graph and returns current counts', async () => {
    const before = reader.services().length;
    writeFileSync(
      path.join(reader.graphDir, 'services.json'),
      JSON.stringify({
        schema_version: '2.0',
        services: [
          ...reader.services(),
          {
            id: 'svc-b',
            repo: '/nonexistent/svc-b',
            type: 'microservice',
            tech_stack: {
              languages: [],
              frameworks: [],
              build: [],
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

    const res = await refreshTool.handler({}, { reader, cwd: tmp });
    const data = res.data as { service_count: number };
    expect(data.service_count).toBe(before + 1);
  });

  it('health flags services with missing local repo paths', async () => {
    const res = await healthTool.handler({}, { reader, cwd: tmp });
    const data = res.data as {
      schema_version: string;
      missing_repo_paths: string[];
    };
    expect(data.schema_version).toBe('2.0');
    expect(data.missing_repo_paths).toContain('svc-a');
  });
});
