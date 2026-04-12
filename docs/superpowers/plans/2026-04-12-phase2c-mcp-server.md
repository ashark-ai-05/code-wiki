# Phase 2c — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `code-wiki mcp` — a stateless MCP server over stdio that exposes 14 tools (graph queries, code access, meta) so any MCP-compatible agent (Claude Code, amp, opencode, copilot-cli) can query the code-wiki graph using natural language. This is the slice that makes "query the codebase with NLP" actually work. Releases `v0.3.0` together with slice 2b.

**Architecture:** A new `src/mcp/` module with three layers: a `GraphReader` that loads and re-loads `graph/*.json` from disk on demand; a tool catalog where each tool is a self-contained object (`name`, `description`, `inputSchema`, `handler`); and a small `server.ts` that wires the Anthropic `@modelcontextprotocol/sdk` Server + `StdioServerTransport` to the catalog. A single new CLI subcommand `code-wiki mcp` boots the server. Every tool returns the same envelope: `{ data, evidence, confidence, sources }`. No HTTP, no auth, no daemon — fresh process per agent connection.

**Tech Stack:** TypeScript 5.x, Node 22+, Vitest, `@modelcontextprotocol/sdk` (new dependency). No database, no embeddings, no LLM calls.

---

## File Structure

```
code-wiki/
├── package.json                          # MODIFY: add @modelcontextprotocol/sdk
├── bin/code-wiki.ts                      # MODIFY: add 'mcp' subcommand
├── src/mcp/
│   ├── server.ts                         # NEW: MCP Server + StdioTransport wiring
│   ├── graph-reader.ts                   # NEW: loads & caches graph JSON, supports refresh()
│   ├── response.ts                       # NEW: ToolResponse envelope + helpers
│   ├── paths.ts                          # NEW: graph source discovery
│   └── tools/
│       ├── index.ts                      # NEW: export all tools
│       ├── graph.ts                      # NEW: 6 graph tools
│       ├── workflows.ts                  # NEW: 2 workflow tools (stubbed)
│       ├── code.ts                       # NEW: 3 code tools
│       └── meta.ts                       # NEW: 3 meta tools
├── tests/mcp/
│   ├── graph-reader.test.ts              # NEW
│   ├── paths.test.ts                     # NEW
│   ├── tools/
│   │   ├── graph.test.ts                 # NEW
│   │   ├── workflows.test.ts             # NEW
│   │   ├── code.test.ts                  # NEW
│   │   └── meta.test.ts                  # NEW
│   └── server.integration.test.ts        # NEW: spawns the binary, sends JSON-RPC
└── docs/mcp/
    └── client-setup.md                   # NEW: .mcp.json recipes
```

### Tool catalog (matching the spec)

**Graph tools (6):** `list_services`, `get_service`, `find_by_tech`, `trace_downstream`, `trace_upstream`, `get_edges`

**Workflow tools (2):** `list_workflows`, `get_workflow` — shipped as stubs returning an empty/not-found result plus a note that workflow content requires slice 2d's federation.

**Code tools (3):** `list_files`, `read_file`, `search_files`

**Meta tools (3):** `stats`, `refresh`, `health`

### Response envelope (returned by every tool)

```typescript
export interface Evidence {
  kind: 'file' | 'config' | 'graph';
  service_id?: string;
  path?: string;
  line?: number;
}

export interface ToolResponse {
  data: unknown;
  evidence?: Evidence[];
  confidence?: 'static' | 'inferred' | 'mixed';
  sources?: {
    graph_path?: string;
    graph_loaded_at?: string;
    graph_freshness_seconds?: number;
    fingerprint_shas?: Record<string, string>;
  };
}
```

The MCP SDK returns tool results as `content: [{ type: 'text', text: string }]`. We serialize the envelope as pretty JSON and wrap it in a single text content block.

### Tool definition pattern

```typescript
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResponse>;
}

export interface ToolContext {
  reader: GraphReader;
  cwd: string;
}
```

---

## Task 1: Add MCP SDK + graph source discovery

**Files:**
- Modify: `package.json`
- Create: `src/mcp/paths.ts`
- Create: `tests/mcp/paths.test.ts`

- [ ] **Step 1: Install @modelcontextprotocol/sdk**

Run: `npm install @modelcontextprotocol/sdk`

Verify `package.json` now lists `@modelcontextprotocol/sdk` as a runtime dependency (under `dependencies`, not `devDependencies`).

- [ ] **Step 2: Write failing tests for graph path discovery**

Create `tests/mcp/paths.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverGraphPath } from '../../src/mcp/paths.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('discoverGraphPath', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-paths-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns CODE_WIKI_GRAPH env var when set', () => {
    const explicit = path.join(tmp, 'explicit', 'graph');
    mkdirSync(explicit, { recursive: true });
    writeFileSync(
      path.join(explicit, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    const result = discoverGraphPath({
      cwd: tmp,
      env: { CODE_WIKI_GRAPH: explicit },
    });
    expect(result).toBe(explicit);
  });

  it('falls back to ./docs/wiki/graph/ when present', () => {
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    mkdirSync(dwg, { recursive: true });
    writeFileSync(
      path.join(dwg, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(dwg);
  });

  it('falls back to ./code-wiki-output/graph/ when present', () => {
    const out = path.join(tmp, 'code-wiki-output', 'graph');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(out);
  });

  it('prefers docs/wiki/graph/ over code-wiki-output/graph/', () => {
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    const out = path.join(tmp, 'code-wiki-output', 'graph');
    mkdirSync(dwg, { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(dwg, 'services.json'), '{}');
    writeFileSync(path.join(out, 'services.json'), '{}');
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(dwg);
  });

  it('returns null when no graph can be found', () => {
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBeNull();
  });

  it('env var wins even if other paths exist', () => {
    const explicit = path.join(tmp, 'explicit');
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    mkdirSync(explicit, { recursive: true });
    mkdirSync(dwg, { recursive: true });
    writeFileSync(path.join(explicit, 'services.json'), '{}');
    writeFileSync(path.join(dwg, 'services.json'), '{}');
    const result = discoverGraphPath({
      cwd: tmp,
      env: { CODE_WIKI_GRAPH: explicit },
    });
    expect(result).toBe(explicit);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement graph path discovery**

Create `src/mcp/paths.ts`:
```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/paths.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/mcp/paths.ts tests/mcp/paths.test.ts
git commit -m "feat(mcp): graph path discovery + @modelcontextprotocol/sdk dependency"
```

---

## Task 2: GraphReader — load graph JSON with refresh support

**Files:**
- Create: `src/mcp/graph-reader.ts`
- Create: `tests/mcp/graph-reader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/graph-reader.test.ts`:
```typescript
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

    // Overwrite with fewer services
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
    expect(age).toBeLessThan(10); // just wrote it
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/graph-reader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GraphReader**

Create `src/mcp/graph-reader.ts`:
```typescript
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServiceNode, Edge } from '../graph/types.js';

export interface TechMatrix {
  languages: Record<string, string[]>;
  frameworks: Record<string, string[]>;
  build: Record<string, string[]>;
}

export interface SourcesMeta {
  graph_path: string;
  graph_loaded_at: string;
  graph_freshness_seconds: number;
}

export class GraphReader {
  private _services: ServiceNode[] = [];
  private _edges: Edge[] = [];
  private _matrix: TechMatrix = {
    languages: {},
    frameworks: {},
    build: {},
  };
  private _loadedAt = new Date();
  private _servicesJsonMtime = 0;

  constructor(public readonly graphDir: string) {
    this.refresh();
  }

  refresh(): void {
    const servicesPath = path.join(this.graphDir, 'services.json');
    if (!existsSync(servicesPath)) {
      throw new Error(
        `services.json not found at ${servicesPath}. Run 'code-wiki build' first.`
      );
    }
    const servicesRaw = JSON.parse(
      readFileSync(servicesPath, 'utf-8')
    ) as { services?: ServiceNode[] };
    this._services = servicesRaw.services ?? [];
    this._servicesJsonMtime = statSync(servicesPath).mtimeMs;

    const edgesPath = path.join(this.graphDir, 'edges.json');
    if (existsSync(edgesPath)) {
      const edgesRaw = JSON.parse(
        readFileSync(edgesPath, 'utf-8')
      ) as { edges?: Edge[] };
      this._edges = edgesRaw.edges ?? [];
    } else {
      this._edges = [];
    }

    const matrixPath = path.join(this.graphDir, 'tech-matrix.json');
    if (existsSync(matrixPath)) {
      this._matrix = JSON.parse(
        readFileSync(matrixPath, 'utf-8')
      ) as TechMatrix;
    } else {
      this._matrix = { languages: {}, frameworks: {}, build: {} };
    }

    this._loadedAt = new Date();
  }

  services(): ServiceNode[] {
    return this._services;
  }

  edges(): Edge[] {
    return this._edges;
  }

  techMatrix(): TechMatrix {
    return this._matrix;
  }

  getServiceById(id: string): ServiceNode | undefined {
    return this._services.find((s) => s.id === id);
  }

  freshnessSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this._servicesJsonMtime) / 1000));
  }

  sourcesMeta(): SourcesMeta {
    return {
      graph_path: this.graphDir,
      graph_loaded_at: this._loadedAt.toISOString(),
      graph_freshness_seconds: this.freshnessSeconds(),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/graph-reader.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/graph-reader.ts tests/mcp/graph-reader.test.ts
git commit -m "feat(mcp): GraphReader loads services/edges/matrix with refresh support"
```

---

## Task 3: Response envelope + tool types

**Files:**
- Create: `src/mcp/response.ts`
- Create: `src/mcp/tools/index.ts`

- [ ] **Step 1: Create response helpers**

Create `src/mcp/response.ts`:
```typescript
import type { GraphReader } from './graph-reader.js';

export interface Evidence {
  kind: 'file' | 'config' | 'graph';
  service_id?: string;
  path?: string;
  line?: number;
}

export interface ToolResponse {
  data: unknown;
  evidence?: Evidence[];
  confidence?: 'static' | 'inferred' | 'mixed';
  sources?: {
    graph_path?: string;
    graph_loaded_at?: string;
    graph_freshness_seconds?: number;
    fingerprint_shas?: Record<string, string>;
  };
}

/**
 * Build a standard response with graph sources auto-populated.
 */
export function buildResponse(
  reader: GraphReader,
  partial: Omit<ToolResponse, 'sources'> & {
    sources?: ToolResponse['sources'];
  }
): ToolResponse {
  return {
    ...partial,
    sources: {
      ...reader.sourcesMeta(),
      ...partial.sources,
    },
  };
}

/**
 * MCP SDK expects tool results shaped like `{ content: [{ type: 'text', text }] }`.
 * We serialize the envelope as pretty JSON.
 */
export function toMcpResult(response: ToolResponse): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
  };
}
```

- [ ] **Step 2: Create the tools index skeleton**

Create `src/mcp/tools/index.ts`:
```typescript
import type { GraphReader } from '../graph-reader.js';
import type { ToolResponse } from '../response.js';

export interface ToolContext {
  reader: GraphReader;
  cwd: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResponse>;
}

export const ALL_TOOLS: McpTool[] = [];
```

The `ALL_TOOLS` array will be populated by later tasks (each task `push`es its tools). For now it's empty.

- [ ] **Step 3: Commit**

No tests in this task — these files are pure plumbing used by later tasks.

```bash
git add src/mcp/response.ts src/mcp/tools/index.ts
git commit -m "feat(mcp): response envelope + tool catalog plumbing"
```

---

## Task 4: Graph tools — list_services, get_service, find_by_tech

**Files:**
- Create: `src/mcp/tools/graph.ts`
- Create: `tests/mcp/tools/graph.test.ts`
- Modify: `src/mcp/tools/index.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/tools/graph.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listServicesTool,
  getServiceTool,
  findByTechTool,
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
    JSON.stringify({ schema_version: '2.0', edges: [] })
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three tools**

Create `src/mcp/tools/graph.ts`:
```typescript
import type { McpTool } from './index.js';
import { buildResponse } from '../response.js';
import { ALL_TOOLS } from './index.js';

export const listServicesTool: McpTool = {
  name: 'list_services',
  description:
    'List all services in the graph. Optionally filter by language (substring), framework (exact), or build tool (exact).',
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Filter by language substring (e.g., "java")',
      },
      framework: {
        type: 'string',
        description: 'Filter by exact framework name (e.g., "spring-boot")',
      },
      build: {
        type: 'string',
        description: 'Filter by exact build tool name (e.g., "gradle")',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const langFilter = args.language as string | undefined;
    const fwFilter = args.framework as string | undefined;
    const buildFilter = args.build as string | undefined;

    const services = reader.services().filter((s) => {
      if (
        langFilter &&
        !s.tech_stack.languages.some((l) => l.includes(langFilter))
      ) {
        return false;
      }
      if (
        fwFilter &&
        !s.tech_stack.frameworks.includes(fwFilter)
      ) {
        return false;
      }
      if (
        buildFilter &&
        !s.tech_stack.build.includes(buildFilter)
      ) {
        return false;
      }
      return true;
    });

    return buildResponse(reader, {
      data: {
        services: services.map((s) => ({
          id: s.id,
          repo: s.repo,
          languages: s.tech_stack.languages,
          frameworks: s.tech_stack.frameworks,
          build: s.tech_stack.build,
          exposes_count: s.exposes.length,
          consumes_count: s.consumes.length,
        })),
      },
      confidence: 'static',
    });
  },
};

export const getServiceTool: McpTool = {
  name: 'get_service',
  description:
    'Get full details of one service by id, including all exposes and consumes entries with source evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The service id' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const id = args.id as string;
    const service = reader.getServiceById(id) ?? null;
    return buildResponse(reader, {
      data: { service },
      confidence: 'static',
    });
  },
};

export const findByTechTool: McpTool = {
  name: 'find_by_tech',
  description:
    'Find all services using a given technology. Category is one of "languages", "frameworks", or "build"; value is the exact key to look up.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['languages', 'frameworks', 'build'],
      },
      value: {
        type: 'string',
        description:
          'The technology key (e.g., "java:17", "spring-boot", "gradle")',
      },
    },
    required: ['category', 'value'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const category = args.category as 'languages' | 'frameworks' | 'build';
    const value = args.value as string;
    const matrix = reader.techMatrix();
    const services = matrix[category]?.[value] ?? [];
    return buildResponse(reader, {
      data: { category, value, services },
      confidence: 'static',
    });
  },
};

ALL_TOOLS.push(listServicesTool, getServiceTool, findByTechTool);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/graph.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/graph.ts tests/mcp/tools/graph.test.ts
git commit -m "feat(mcp): graph tools — list_services, get_service, find_by_tech"
```

---

## Task 5: Graph traversal tools — trace_downstream, trace_upstream, get_edges

**Files:**
- Modify: `src/mcp/tools/graph.ts`
- Modify: `tests/mcp/tools/graph.test.ts`

- [ ] **Step 1: Add failing tests**

Update the sample edges in `writeSampleGraph` to make traversal testable. Replace the `edges.json` write with edges that form a chain `svc-a → svc-b`:

```typescript
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
```

Then add the following tests inside the `describe('graph tools', ...)` block:

```typescript
  it('trace_downstream follows outgoing edges one level', async () => {
    const { traceDownstreamTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
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
    const { traceUpstreamTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
    const res = await traceUpstreamTool.handler(
      { service_id: 'svc-b' },
      { reader, cwd: tmp }
    );
    const data = res.data as { reached: string[] };
    expect(data.reached).toEqual(['svc-a']);
  });

  it('get_edges returns all edges when no filter', async () => {
    const { getEdgesTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
    const res = await getEdgesTool.handler(
      {},
      { reader, cwd: tmp }
    );
    const data = res.data as { edges: Array<{ id: string }> };
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].id).toBe('e001');
  });

  it('get_edges filters by type', async () => {
    const { getEdgesTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
    const res = await getEdgesTool.handler(
      { type: 'kafka' },
      { reader, cwd: tmp }
    );
    const data = res.data as { edges: unknown[] };
    expect(data.edges).toHaveLength(1);
  });

  it('get_edges returns empty when type does not match', async () => {
    const { getEdgesTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
    const res = await getEdgesTool.handler(
      { type: 'rest' },
      { reader, cwd: tmp }
    );
    const data = res.data as { edges: unknown[] };
    expect(data.edges).toHaveLength(0);
  });

  it('trace_downstream supports edge_types filter', async () => {
    const { traceDownstreamTool } = await import(
      '../../../src/mcp/tools/graph.js'
    );
    const res = await traceDownstreamTool.handler(
      { service_id: 'svc-a', edge_types: ['rest'] },
      { reader, cwd: tmp }
    );
    const data = res.data as { reached: string[] };
    expect(data.reached).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/graph.test.ts`
Expected: FAIL — traversal tools don't exist.

- [ ] **Step 3: Add the three traversal tools**

Append to `src/mcp/tools/graph.ts` (above the final `ALL_TOOLS.push(...)` line):

```typescript
export const traceDownstreamTool: McpTool = {
  name: 'trace_downstream',
  description:
    'Walk outgoing edges from a service. `depth` limits hops (default 1). `edge_types` filters by edge type (e.g., ["kafka"]).',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      edge_types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: restrict to these edge types',
      },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const startId = args.service_id as string;
    const depth = (args.depth as number) ?? 1;
    const edgeTypes = args.edge_types as string[] | undefined;
    const reached = traverse(reader.edges(), startId, depth, edgeTypes, 'out');
    return buildResponse(reader, {
      data: { from: startId, depth, reached },
      confidence: 'static',
    });
  },
};

export const traceUpstreamTool: McpTool = {
  name: 'trace_upstream',
  description:
    'Walk incoming edges to a service. `depth` limits hops (default 1). `edge_types` filters by edge type.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      edge_types: { type: 'array', items: { type: 'string' } },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const startId = args.service_id as string;
    const depth = (args.depth as number) ?? 1;
    const edgeTypes = args.edge_types as string[] | undefined;
    const reached = traverse(reader.edges(), startId, depth, edgeTypes, 'in');
    return buildResponse(reader, {
      data: { to: startId, depth, reached },
      confidence: 'static',
    });
  },
};

export const getEdgesTool: McpTool = {
  name: 'get_edges',
  description:
    'List edges in the graph, optionally filtered by type, from, or to.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Edge type, e.g., "kafka"' },
      from: { type: 'string', description: 'Source service id' },
      to: { type: 'string', description: 'Target service id' },
    },
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const typeFilter = args.type as string | undefined;
    const fromFilter = args.from as string | undefined;
    const toFilter = args.to as string | undefined;

    const edges = reader.edges().filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (fromFilter && e.from !== fromFilter) return false;
      if (toFilter && e.to !== toFilter) return false;
      return true;
    });

    return buildResponse(reader, {
      data: { edges },
      confidence: 'static',
    });
  },
};

function traverse(
  edges: import('../../graph/types.js').Edge[],
  startId: string,
  depth: number,
  edgeTypes: string[] | undefined,
  direction: 'in' | 'out'
): string[] {
  const visited = new Set<string>();
  let frontier = new Set<string>([startId]);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const edge of edges) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (direction === 'out' && edge.from === node) {
          if (!visited.has(edge.to) && edge.to !== startId) {
            next.add(edge.to);
          }
        }
        if (direction === 'in' && edge.to === node) {
          if (!visited.has(edge.from) && edge.from !== startId) {
            next.add(edge.from);
          }
        }
      }
    }
    for (const n of next) visited.add(n);
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [...visited];
}
```

And update the final push line to register them:
```typescript
ALL_TOOLS.push(
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/graph.test.ts`
Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/graph.ts tests/mcp/tools/graph.test.ts
git commit -m "feat(mcp): trace_downstream, trace_upstream, get_edges tools"
```

---

## Task 6: Workflow tools (stubbed for slice 2c)

**Files:**
- Create: `src/mcp/tools/workflows.ts`
- Create: `tests/mcp/tools/workflows.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/tools/workflows.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listWorkflowsTool,
  getWorkflowTool,
} from '../../../src/mcp/tools/workflows.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('workflow tools', () => {
  let tmp: string;
  let reader: GraphReader;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({ schema_version: '2.0', services: [] })
    );
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('list_workflows returns empty list with a note', async () => {
    const res = await listWorkflowsTool.handler(
      {},
      { reader, cwd: tmp }
    );
    const data = res.data as { workflows: unknown[]; note: string };
    expect(data.workflows).toEqual([]);
    expect(data.note.toLowerCase()).toContain('federation');
  });

  it('get_workflow returns not_found with a note', async () => {
    const res = await getWorkflowTool.handler(
      { name: 'order-placement' },
      { reader, cwd: tmp }
    );
    const data = res.data as {
      workflow: null;
      not_found: true;
      note: string;
    };
    expect(data.workflow).toBeNull();
    expect(data.not_found).toBe(true);
    expect(data.note.toLowerCase()).toContain('federation');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/workflows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement stubbed tools**

Create `src/mcp/tools/workflows.ts`:
```typescript
import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

const FEDERATION_NOTE =
  'Workflow data is populated by the federation merge job (slice 2d). In single-repo mode, no workflows are available yet.';

export const listWorkflowsTool: McpTool = {
  name: 'list_workflows',
  description:
    'List named workflows across the graph. In single-repo mode without federation, this returns an empty list with a note.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: { workflows: [], note: FEDERATION_NOTE },
      confidence: 'static',
    }),
};

export const getWorkflowTool: McpTool = {
  name: 'get_workflow',
  description:
    'Get the service list + edges that make up a named workflow. Returns null + a note in single-repo mode.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: { workflow: null, not_found: true, note: FEDERATION_NOTE },
      confidence: 'static',
    }),
};

ALL_TOOLS.push(listWorkflowsTool, getWorkflowTool);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/workflows.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/workflows.ts tests/mcp/tools/workflows.test.ts
git commit -m "feat(mcp): list_workflows + get_workflow stubs (real data in slice 2d)"
```

---

## Task 7: Code tools — list_files, read_file, search_files

**Files:**
- Create: `src/mcp/tools/code.ts`
- Create: `tests/mcp/tools/code.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/tools/code.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
} from '../../../src/mcp/tools/code.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('code tools', () => {
  let tmp: string;
  let reader: GraphReader;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-code-'));
    repoRoot = path.join(tmp, 'repos', 'svc-a');
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'src', 'main.ts'),
      'line 1\nline 2 WIDGET\nline 3\n'
    );
    writeFileSync(
      path.join(repoRoot, 'README.md'),
      '# svc-a\n'
    );

    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({
        schema_version: '2.0',
        services: [
          {
            id: 'svc-a',
            repo: repoRoot,
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
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('list_files returns files in a service repo', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'svc-a' },
      { reader, cwd: tmp }
    );
    const data = res.data as { files: string[] };
    expect(data.files).toContain('README.md');
    expect(data.files).toContain('src/main.ts');
  });

  it('list_files filters by glob', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'svc-a', glob: '**/*.ts' },
      { reader, cwd: tmp }
    );
    const data = res.data as { files: string[] };
    expect(data.files).toEqual(['src/main.ts']);
  });

  it('list_files returns error when service not in graph', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'nope' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('not found');
  });

  it('list_files returns error when repo path does not exist', async () => {
    // Remove the repo but keep it in the graph
    rmSync(repoRoot, { recursive: true, force: true });
    const res = await listFilesTool.handler(
      { service_id: 'svc-a' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('clone');
  });

  it('read_file returns file contents', async () => {
    const res = await readFileTool.handler(
      { service_id: 'svc-a', path: 'src/main.ts' },
      { reader, cwd: tmp }
    );
    const data = res.data as { content: string };
    expect(data.content).toContain('WIDGET');
  });

  it('read_file supports line range', async () => {
    const res = await readFileTool.handler(
      {
        service_id: 'svc-a',
        path: 'src/main.ts',
        start_line: 2,
        end_line: 2,
      },
      { reader, cwd: tmp }
    );
    const data = res.data as { content: string };
    expect(data.content).toBe('line 2 WIDGET');
  });

  it('read_file refuses paths that escape the repo root', async () => {
    const res = await readFileTool.handler(
      { service_id: 'svc-a', path: '../../etc/passwd' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('outside');
  });

  it('search_files returns matching file:line pairs', async () => {
    const res = await searchFilesTool.handler(
      { service_id: 'svc-a', pattern: 'WIDGET' },
      { reader, cwd: tmp }
    );
    const data = res.data as {
      matches: Array<{ path: string; line: number; text: string }>;
    };
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].path).toBe('src/main.ts');
    expect(data.matches[0].line).toBe(2);
    expect(data.matches[0].text).toContain('WIDGET');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement code tools**

Create `src/mcp/tools/code.ts`:
```typescript
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import glob from 'fast-glob';
import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

const MAX_BYTES_PER_READ = 512 * 1024; // 512 KB
const MAX_SEARCH_MATCHES = 200;

function resolveRepoRoot(
  reader: import('../graph-reader.js').GraphReader,
  serviceId: string
): { ok: true; root: string } | { ok: false; error: string } {
  const svc = reader.getServiceById(serviceId);
  if (!svc) {
    return { ok: false, error: `Service "${serviceId}" not found in graph.` };
  }
  if (!existsSync(svc.repo)) {
    return {
      ok: false,
      error: `Repo path does not exist locally: ${svc.repo}. Clone the repo or set up CODE_WIKI_REPO_ROOT.`,
    };
  }
  return { ok: true, root: svc.repo };
}

function safeJoin(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

export const listFilesTool: McpTool = {
  name: 'list_files',
  description:
    'List files in a service\'s repository. Optional glob filter (e.g., "**/*.ts").',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      glob: { type: 'string', default: '**/*' },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    const pattern = (args.glob as string) ?? '**/*';
    const files = await glob([pattern], {
      cwd: r.root,
      ignore: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/.git/**',
        '**/build/**',
        '**/target/**',
        '**/dist/**',
      ],
    });
    return buildResponse(reader, {
      data: { service_id: args.service_id, files: files.sort() },
      confidence: 'static',
    });
  },
};

export const readFileTool: McpTool = {
  name: 'read_file',
  description:
    'Read the contents of a file in a service\'s repository. Optional start_line / end_line (1-indexed, inclusive).',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      path: { type: 'string', description: 'Path relative to repo root' },
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
    },
    required: ['service_id', 'path'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    const abs = safeJoin(r.root, args.path as string);
    if (!abs) {
      return buildResponse(reader, {
        data: { error: 'Refusing to read path outside the repo root.' },
      });
    }
    if (!existsSync(abs)) {
      return buildResponse(reader, {
        data: { error: `File not found: ${args.path}` },
      });
    }

    let content = readFileSync(abs, 'utf-8');
    if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES_PER_READ) {
      content = content.slice(0, MAX_BYTES_PER_READC);
    }

    const startLine = args.start_line as number | undefined;
    const endLine = args.end_line as number | undefined;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const s = (startLine ?? 1) - 1;
      const e = endLine ?? lines.length;
      content = lines.slice(s, e).join('\n');
    }

    return buildResponse(reader, {
      data: {
        service_id: args.service_id,
        path: args.path,
        content,
      },
      evidence: [
        {
          kind: 'file',
          service_id: args.service_id as string,
          path: args.path as string,
          line: startLine,
        },
      ],
      confidence: 'static',
    });
  },
};

export const searchFilesTool: McpTool = {
  name: 'search_files',
  description:
    'Search for a regex pattern in a service\'s files. Returns up to 200 file:line matches. Optional glob to restrict search paths.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      pattern: { type: 'string', description: 'Regex pattern (JavaScript flavor)' },
      glob: { type: 'string', default: '**/*' },
    },
    required: ['service_id', 'pattern'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern as string);
    } catch (err) {
      return buildResponse(reader, {
        data: { error: `Invalid regex: ${(err as Error).message}` },
      });
    }

    const pattern = (args.glob as string) ?? '**/*';
    const files = await glob([pattern], {
      cwd: r.root,
      ignore: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/.git/**',
        '**/build/**',
        '**/target/**',
        '**/dist/**',
      ],
    });

    const matches: Array<{ path: string; line: number; text: string }> = [];
    outer: for (const rel of files) {
      const abs = path.join(r.root, rel);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ path: rel, line: i + 1, text: lines[i] });
          if (matches.length >= MAX_SEARCH_MATCHES) break outer;
        }
      }
    }

    return buildResponse(reader, {
      data: {
        service_id: args.service_id,
        pattern: args.pattern,
        matches,
        truncated: matches.length >= MAX_SEARCH_MATCHES,
      },
      confidence: 'static',
    });
  },
};

ALL_TOOLS.push(listFilesTool, readFileTool, searchFilesTool);
```

**Typo check:** the line `content = content.slice(0, MAX_BYTES_PER_READC);` has a typo — the constant is `MAX_BYTES_PER_READ`. Fix it to read:
```typescript
      content = content.slice(0, MAX_BYTES_PER_READ);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/code.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/code.ts tests/mcp/tools/code.test.ts
git commit -m "feat(mcp): code tools — list_files, read_file, search_files"
```

---

## Task 8: Meta tools — stats, refresh, health

**Files:**
- Create: `src/mcp/tools/meta.ts`
- Create: `tests/mcp/tools/meta.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/tools/meta.test.ts`:
```typescript
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
    // Simulate an external rebuild: add a service
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement meta tools**

Create `src/mcp/tools/meta.ts`:
```typescript
import { existsSync } from 'node:fs';
import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

export const statsTool: McpTool = {
  name: 'stats',
  description:
    'Counts and freshness of the loaded graph. Use this to check whether a refresh is needed.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: {
        service_count: reader.services().length,
        edge_count: reader.edges().length,
        graph_path: reader.graphDir,
        graph_freshness_seconds: reader.freshnessSeconds(),
      },
    }),
};

export const refreshTool: McpTool = {
  name: 'refresh',
  description:
    'Re-read graph files from disk. Use after running `code-wiki build` or pulling the federation repo.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) => {
    reader.refresh();
    return buildResponse(reader, {
      data: {
        refreshed: true,
        service_count: reader.services().length,
        edge_count: reader.edges().length,
      },
    });
  },
};

export const healthTool: McpTool = {
  name: 'health',
  description:
    'Report schema version, graph freshness, and any services whose local repo paths are missing.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) => {
    const missing: string[] = [];
    for (const svc of reader.services()) {
      if (!existsSync(svc.repo)) missing.push(svc.id);
    }
    return buildResponse(reader, {
      data: {
        schema_version: '2.0',
        graph_freshness_seconds: reader.freshnessSeconds(),
        service_count: reader.services().length,
        edge_count: reader.edges().length,
        missing_repo_paths: missing,
      },
    });
  },
};

ALL_TOOLS.push(statsTool, refreshTool, healthTool);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/meta.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/meta.ts tests/mcp/tools/meta.test.ts
git commit -m "feat(mcp): meta tools — stats, refresh, health"
```

---

## Task 9: MCP server + CLI wiring

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `src/mcp/tools/index.ts` (export ALL_TOOLS with all registrations)
- Modify: `bin/code-wiki.ts` (add `mcp` subcommand)

- [ ] **Step 1: Fix tools/index to aggregate all tools**

The previous tasks all `push` to `ALL_TOOLS` at module-load time, but the array is only populated when each tool module is imported. Replace `src/mcp/tools/index.ts` with:

```typescript
import type { GraphReader } from '../graph-reader.js';
import type { ToolResponse } from '../response.js';

export interface ToolContext {
  reader: GraphReader;
  cwd: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResponse>;
}

// Import side effects: each module pushes its tools onto the array below.
import {
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool,
} from './graph.js';
import {
  listWorkflowsTool,
  getWorkflowTool,
} from './workflows.js';
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
} from './code.js';
import {
  statsTool,
  refreshTool,
  healthTool,
} from './meta.js';

export const ALL_TOOLS: McpTool[] = [
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool,
  listWorkflowsTool,
  getWorkflowTool,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  statsTool,
  refreshTool,
  healthTool,
];
```

**Important:** remove the `ALL_TOOLS.push(...)` lines from each tool module (`graph.ts`, `workflows.ts`, `code.ts`, `meta.ts`) and their `import { ALL_TOOLS } from './index.js';` lines. The array is now authoritatively defined in `index.ts`.

- [ ] **Step 2: Implement the server**

Create `src/mcp/server.ts`:
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { discoverGraphPath } from './paths.js';
import { GraphReader } from './graph-reader.js';
import { ALL_TOOLS } from './tools/index.js';
import { toMcpResult } from './response.js';

export async function runMcpServer(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<void> {
  const graphDir = discoverGraphPath(opts);
  if (!graphDir) {
    throw new Error(
      'No graph found. Run `code-wiki build` first, or set CODE_WIKI_GRAPH.'
    );
  }
  const reader = new GraphReader(graphDir);
  const ctx = { reader, cwd: opts.cwd };

  const server = new Server(
    { name: 'code-wiki', version: '0.3.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = ALL_TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const response = await tool.handler(args, ctx);
    return toMcpResult(response);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 3: Add `mcp` subcommand to the CLI**

Open `bin/code-wiki.ts`. Add the import at the top:
```typescript
import { runMcpServer } from '../src/mcp/server.js';
```

Then add a new subcommand near the other commands:
```typescript
program
  .command('mcp')
  .description('Run as an MCP server over stdio')
  .action(async () => {
    try {
      await runMcpServer({
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (err) {
      console.error('[code-wiki mcp]', (err as Error).message);
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Typecheck + run ALL existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests still pass (the tool tests from earlier tasks should still work because handlers are unchanged — only the `ALL_TOOLS` aggregation moved).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/tools/index.ts src/mcp/tools/graph.ts src/mcp/tools/workflows.ts src/mcp/tools/code.ts src/mcp/tools/meta.ts bin/code-wiki.ts
git commit -m "feat(mcp): server entry + code-wiki mcp CLI subcommand"
```

---

## Task 10: Integration test + client setup docs

**Files:**
- Create: `tests/mcp/server.integration.test.ts`
- Create: `docs/mcp/client-setup.md`

- [ ] **Step 1: Write the integration test**

Create `tests/mcp/server.integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface Rpc {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

async function sendAndReceive(
  proc: ChildProcessWithoutNullStreams,
  msg: Rpc,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const newlineIdx = buf.indexOf('\n');
      if (newlineIdx >= 0) {
        const line = buf.slice(0, newlineIdx);
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === msg.id) {
            proc.stdout.off('data', onData);
            resolve(parsed);
          }
        } catch {
          /* keep buffering */
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error('timeout waiting for response'));
    }, timeoutMs);
  });
}

describe('MCP server integration', () => {
  let tmp: string;
  let proc: ChildProcessWithoutNullStreams;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-mcp-it-'));
    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({
        schema_version: '2.0',
        services: [
          {
            id: 'svc-a',
            repo: tmp,
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
      JSON.stringify({ schema_version: '2.0', edges: [] })
    );
    writeFileSync(
      path.join(graphDir, 'tech-matrix.json'),
      JSON.stringify({
        languages: { 'go:1.22': ['svc-a'] },
        frameworks: {},
        build: { go: ['svc-a'] },
      })
    );

    proc = spawn(
      'npx',
      ['tsx', 'bin/code-wiki.ts', 'mcp'],
      {
        cwd: process.cwd(),
        env: { ...process.env, CODE_WIKI_GRAPH: graphDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ) as ChildProcessWithoutNullStreams;
  });

  afterEach(() => {
    proc.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('responds to tools/list with the full catalog', async () => {
    // Initialize
    const initResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
    expect(initResp.result).toBeDefined();

    const listResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const tools = (
      listResp.result as { tools: Array<{ name: string }> }
    ).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_services');
    expect(names).toContain('get_service');
    expect(names).toContain('stats');
    expect(names.length).toBe(14);
  });

  it('responds to tools/call list_services with the service', async () => {
    await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const callResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_services', arguments: {} },
    });
    const result = callResp.result as {
      content: Array<{ type: 'text'; text: string }>;
    };
    const payload = JSON.parse(result.content[0].text);
    expect(payload.data.services).toHaveLength(1);
    expect(payload.data.services[0].id).toBe('svc-a');
    expect(payload.sources.graph_path).toContain('graph');
  });
}, 20000);
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/mcp/server.integration.test.ts`

Expected: both tests PASS. If the test fails with a timeout, confirm that `npx tsx bin/code-wiki.ts mcp` runs without crashing when invoked manually with `CODE_WIKI_GRAPH` set.

- [ ] **Step 3: Write the client setup doc**

Create `docs/mcp/client-setup.md`:
```markdown
# Connecting agents to code-wiki's MCP server

`code-wiki mcp` runs an MCP server over stdio. Every MCP-compatible agent
can spawn it the same way.

## Prerequisites

1. Install code-wiki globally or in your project: `npm install -g code-wiki`.
2. Run `code-wiki build` at least once so a graph exists to query.

## Claude Code

Add this entry to your project's `.mcp.json` (or to Claude Code's user config):

```json
{
  "mcpServers": {
    "code-wiki": {
      "command": "code-wiki",
      "args": ["mcp"]
    }
  }
}
```

Then restart Claude Code. The 14 tools (`list_services`, `get_service`,
`trace_downstream`, etc.) become available.

## amp / opencode / copilot-cli

These agents also speak MCP. Add the same `command`/`args` pair to whichever
config file the agent uses for MCP server registration. Consult the agent's
own docs for the exact path.

## Environment overrides

- `CODE_WIKI_GRAPH` — absolute path to a `graph/` directory, overrides
  discovery. Useful in CI.

## Tool reference

| Tool | Purpose |
|------|---------|
| `list_services` | All services in the graph, optional tech filters |
| `get_service` | Full record for one service by id |
| `find_by_tech` | Services by language/framework/build tool |
| `trace_downstream` | Walk outgoing edges N hops |
| `trace_upstream` | Walk incoming edges N hops |
| `get_edges` | All edges, filtered by type/from/to |
| `list_workflows` | Named workflows (empty until federation enabled) |
| `get_workflow` | One workflow by name (empty until federation enabled) |
| `list_files` | Files in a service's local repo clone |
| `read_file` | Contents of a file in a service's repo |
| `search_files` | Regex search across a service's files |
| `stats` | Service/edge counts + freshness |
| `refresh` | Reload the graph after rebuilds |
| `health` | Schema version, freshness, missing repo paths |
```

- [ ] **Step 4: Commit**

```bash
git add tests/mcp/server.integration.test.ts docs/mcp/client-setup.md
git commit -m "feat(mcp): integration test + .mcp.json client setup docs"
```

---

## Task 11: Release v0.3.0

**Files:**
- Modify: `package.json`
- Verification only for the rest.

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: all tests PASS. Total should be at least 110.

- [ ] **Step 2: Bump version**

Open `package.json`. Change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 3: Smoke test end to end**

```bash
rm -rf /tmp/code-wiki-2c-check
npx tsx bin/code-wiki.ts build --path tests/fixtures/repos --output /tmp/code-wiki-2c-check
```

Then, from a second shell or with stdin redirection, exercise the MCP server:
```bash
CODE_WIKI_GRAPH=/tmp/code-wiki-2c-check/graph printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | npx tsx bin/code-wiki.ts mcp 2>/dev/null | head -5
```

Expected: two JSON responses (one `initialize`, one `tools/list`) with 14 tools listed.

- [ ] **Step 4: Commit and tag**

```bash
git add package.json
git commit -m "chore: release v0.3.0 — MCP server + generator refactor"
git tag v0.3.0
```

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/code-wiki-2c-check
```

---

## Summary

| Task | Component | Tests | Commits |
|------|-----------|-------|---------|
| 1 | Graph path discovery | 6 | 1 |
| 2 | GraphReader | 7 | 1 |
| 3 | Response envelope + tool types | 0 | 1 |
| 4 | list_services, get_service, find_by_tech | 7 | 1 |
| 5 | trace_downstream, trace_upstream, get_edges | 6 | 1 |
| 6 | list_workflows, get_workflow (stubs) | 2 | 1 |
| 7 | list_files, read_file, search_files | 8 | 1 |
| 8 | stats, refresh, health | 3 | 1 |
| 9 | MCP server + CLI wiring | - | 1 |
| 10 | Integration test + docs | 2 | 1 |
| 11 | Release v0.3.0 | - | 1 |

**Total:** ~41 new tests, 11 commits, one release tag (`v0.3.0`).

## What slice 2c does NOT ship

- HTTP/SSE transport (stdio only).
- Semantic / vector search tool (Sourcegraph MCP complements it).
- Real workflow data (slice 2d's federation).
- Clone-on-demand for code tools (slice 3).
- Authenticated access.
