# Phase 2d — Git-Native Federation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the git-native federation pipeline — each repo's CI can `code-wiki publish` its fingerprint to a shared `code-wiki-org` repo; that repo runs `code-wiki merge` to rebuild an org-wide `graph/` + `workflows.json`; and the MCP server in any clone transparently picks up the federated graph. When this lands, questions like *"which services consume topic X across the org?"* get answered. No release tag — slice 2d + 2e together ship `v0.4.0`.

**Architecture:** A new `src/federation/` module owns git operations (clone, pull, commit, push) and the merge logic. All git access shells out to the system `git` binary via `child_process.spawn` with explicit argv — no `exec` and no shell interpolation, so no command injection surface. A `FederationClient` abstracts per-provider specifics (git, S3, HTTP service) behind a narrow interface; only the git provider is implemented in 2d. The merge job reads `fingerprints/*.json` files, applies identifier normalization (from slice 2a), builds the graph via the existing `buildGraph` in `src/graph/builder.ts`, and writes `services.json`, `edges.json`, `workflows.json`, `tech-matrix.json`. Workflows are resolved by taking each fingerprint's `workflows_declared` and walking the edge graph from the declared entry points. MCP graph-path discovery gains a fourth candidate: `~/.code-wiki/org/graph/`.

**Tech Stack:** TypeScript 5.x, Node 22+, Vitest, `child_process.spawn` (no new deps). Tests spin up local bare git repos via the same `git` binary.

---

## File Structure

```
code-wiki/
├── src/
│   ├── config/
│   │   └── schema.ts                     # MODIFY: add `federation` section types
│   ├── federation/                       # NEW module
│   │   ├── types.ts                      # NEW: FederationConfig + FederationClient interface
│   │   ├── git.ts                        # NEW: spawnGit helper (no shell)
│   │   ├── git-client.ts                 # NEW: GitFederationClient (clone/pull/commit/push)
│   │   ├── fingerprint-io.ts             # NEW: serialize/parse fingerprint.json
│   │   ├── publish.ts                    # NEW: code-wiki publish orchestrator
│   │   ├── pull.ts                       # NEW: code-wiki pull orchestrator
│   │   ├── merge.ts                      # NEW: code-wiki merge orchestrator
│   │   └── workflows.ts                  # NEW: build workflows.json from fingerprints + edges
│   ├── mcp/
│   │   ├── paths.ts                      # MODIFY: add federation candidate
│   │   └── tools/
│   │       └── workflows.ts              # MODIFY: real implementation (no stub)
│   └── index.ts                          # MODIFY: export new public API
├── bin/code-wiki.ts                      # MODIFY: publish / pull / merge subcommands
├── tests/
│   ├── federation/
│   │   ├── git.test.ts                   # NEW
│   │   ├── fingerprint-io.test.ts        # NEW
│   │   ├── workflows.test.ts             # NEW
│   │   ├── merge.test.ts                 # NEW
│   │   └── publish-pull-merge.integration.test.ts  # NEW (uses local bare repo)
│   └── mcp/
│       ├── paths.test.ts                 # MODIFY: assert federation candidate
│       └── tools/workflows.test.ts       # MODIFY: real data assertions
```

### Key types

```typescript
// src/federation/types.ts
export interface FederationConfig {
  enabled: boolean;
  provider: 'git';
  url: string;
  branch: string;
  publish_strategy: 'branch' | 'direct';
  auth: {
    method: 'ssh' | 'token';
    env_var?: string;
  };
}

export interface FederationClient {
  ensureClone(localDir: string): Promise<void>;
  pullLatest(localDir: string): Promise<void>;
  commitAndPush(
    localDir: string,
    message: string,
    branch?: string
  ): Promise<{ pushed: boolean; branch: string }>;
}

// workflows.json (new, produced by merge)
export interface ResolvedWorkflow {
  name: string;
  entry_points: string[];
  services: string[];   // all services reachable from entry points via edges
  edges: string[];      // edge ids that form the workflow
}

export interface WorkflowsFile {
  schema_version: '2.0';
  workflows: ResolvedWorkflow[];
}
```

---

## Task 1: Config schema — federation section

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/defaults.ts`
- Modify: `tests/config/loader.test.ts`
- Create: `tests/fixtures/configs/federation-config.yaml`

- [ ] **Step 1: Add failing test**

Create `tests/fixtures/configs/federation-config.yaml`:
```yaml
version: "1.0"
sources:
  - provider: local
    paths: ["./repos"]
output:
  wiki_path: ./wiki-output
workflows:
  order-placement:
    description: "Order placement flow"
    entry_points: ["svc-a"]
federation:
  enabled: true
  provider: git
  url: git@bitbucket.org:org/code-wiki-org.git
  branch: main
  publish_strategy: branch
  auth:
    method: ssh
```

Open `tests/config/loader.test.ts`. Add these tests inside the existing `describe('loadConfig', ...)` block:

```typescript
  it('parses federation section when present', () => {
    const config = loadConfig(
      path.join(FIXTURES, 'federation-config.yaml')
    );
    expect(config.federation).toBeDefined();
    expect(config.federation!.enabled).toBe(true);
    expect(config.federation!.provider).toBe('git');
    expect(config.federation!.url).toContain('code-wiki-org');
    expect(config.federation!.publish_strategy).toBe('branch');
    expect(config.federation!.auth.method).toBe('ssh');
  });

  it('leaves federation undefined when section is absent', () => {
    const config = loadConfig(path.join(FIXTURES, 'valid-config.yaml'));
    expect(config.federation).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: FAIL on the federation test — config type has no `federation` field.

- [ ] **Step 3: Extend schema types**

Open `src/config/schema.ts`. Add new interfaces:

```typescript
export interface FederationAuth {
  method: 'ssh' | 'token';
  env_var?: string;
  key_path?: string;
}

export interface FederationConfig {
  enabled: boolean;
  provider: 'git';
  url: string;
  branch: string;
  publish_strategy: 'branch' | 'direct';
  auth: FederationAuth;
}
```

Add `federation?: FederationConfig` to the `CodeWikiConfig` interface.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config/loader.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/loader.test.ts tests/fixtures/configs/federation-config.yaml
git commit -m "feat(federation): add federation section to config schema"
git push
```

---

## Task 2: spawnGit — safe git CLI wrapper

**Files:**
- Create: `src/federation/git.ts`
- Create: `tests/federation/git.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/federation/git.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnGit } from '../../src/federation/git.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('spawnGit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-git-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runs `git init` and captures stdout', async () => {
    const result = await spawnGit(['init'], { cwd: tmp });
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toMatch(/initialized|reinitialized/);
  });

  it('returns non-zero exit code for invalid command', async () => {
    const result = await spawnGit(['this-is-not-a-real-subcommand'], {
      cwd: tmp,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('passes args as argv (no shell interpolation)', async () => {
    // If args were joined into a shell command, a semicolon would run
    // a second command. spawnGit must treat args as literal.
    const result = await spawnGit(
      ['init', '; echo hacked'],
      { cwd: tmp, throwOnError: false }
    );
    // `git init "; echo hacked"` fails because `"; echo hacked"` is not a valid path.
    expect(result.code).not.toBe(0);
    // stderr should NOT contain "hacked" — the semicolon was not interpreted.
    expect(result.stderr).not.toContain('hacked');
    expect(result.stdout).not.toContain('hacked');
  });

  it('throwOnError=true throws on non-zero exit', async () => {
    await expect(
      spawnGit(['fetch', 'nope-nonexistent-remote'], {
        cwd: tmp,
        throwOnError: true,
      })
    ).rejects.toThrow(/git/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/federation/git.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement spawnGit**

Create `src/federation/git.ts`:
```typescript
import { spawn } from 'node:child_process';

export interface SpawnGitOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  throwOnError?: boolean;
  stdin?: string;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke `git` with the given args in `cwd`. Uses `spawn` with an argv array
 * so there is no shell and no command-injection surface.
 */
export async function spawnGit(
  args: string[],
  opts: SpawnGitOptions
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf-8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const result: GitResult = { code: code ?? -1, stdout, stderr };
      if (opts.throwOnError && result.code !== 0) {
        reject(
          new Error(
            `git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr || result.stdout}`
          )
        );
        return;
      }
      resolve(result);
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/federation/git.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/federation/git.ts tests/federation/git.test.ts
git commit -m "feat(federation): spawnGit wrapper — argv-only, no shell injection"
git push
```

---

## Task 3: Fingerprint I/O — serialize/parse fingerprint.json

**Files:**
- Create: `src/federation/fingerprint-io.ts`
- Create: `tests/federation/fingerprint-io.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/federation/fingerprint-io.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFingerprint,
  readFingerprint,
  fingerprintFilename,
} from '../../src/federation/fingerprint-io.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sampleFingerprint(): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name: 'svc-a', path: '/repos/svc-a' },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'java', version: '17', build_tool: 'gradle' }],
    },
    exposes: [],
    consumes: [],
  };
}

describe('fingerprint I/O', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-fpio-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('fingerprintFilename matches repo name', () => {
    const fp = sampleFingerprint();
    expect(fingerprintFilename(fp)).toBe('svc-a.json');
  });

  it('round-trips a fingerprint', () => {
    const fp = sampleFingerprint();
    writeFingerprint(tmp, fp);
    const loaded = readFingerprint(path.join(tmp, 'svc-a.json'));
    expect(loaded.repo.name).toBe('svc-a');
    expect(loaded.schema_version).toBe('2.0');
  });

  it('writeFingerprint emits pretty JSON', () => {
    writeFingerprint(tmp, sampleFingerprint());
    const raw = readFileSync(path.join(tmp, 'svc-a.json'), 'utf-8');
    expect(raw).toContain('\n  ');
  });

  it('readFingerprint rejects invalid schema', () => {
    const badPath = path.join(tmp, 'bad.json');
    writeFileSync(badPath, JSON.stringify({ schema_version: '1.0' }));
    expect(() => readFingerprint(badPath)).toThrow(/schema/i);
  });

  it('rejects repo names containing path separators', () => {
    const evil: RepoFingerprint = {
      ...sampleFingerprint(),
      repo: { name: '../../../etc/passwd', path: '/x' },
    };
    expect(() => writeFingerprint(tmp, evil)).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/federation/fingerprint-io.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement fingerprint I/O**

Create `src/federation/fingerprint-io.ts`:
```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RepoFingerprint } from '../fingerprint/types.js';
import { isValidFingerprint } from '../fingerprint/schema.js';

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function fingerprintFilename(fp: RepoFingerprint): string {
  if (!SAFE_NAME.test(fp.repo.name)) {
    throw new Error(
      `Invalid repo name for fingerprint filename: "${fp.repo.name}". Must match ${SAFE_NAME}.`
    );
  }
  return `${fp.repo.name}.json`;
}

export function writeFingerprint(
  dir: string,
  fp: RepoFingerprint
): string {
  const filename = fingerprintFilename(fp);
  const target = path.join(dir, filename);
  writeFileSync(target, JSON.stringify(fp, null, 2), 'utf-8');
  return target;
}

export function readFingerprint(filePath: string): RepoFingerprint {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (!isValidFingerprint(raw)) {
    throw new Error(`Invalid fingerprint schema: ${filePath}`);
  }
  return raw;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/federation/fingerprint-io.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/federation/fingerprint-io.ts tests/federation/fingerprint-io.test.ts
git commit -m "feat(federation): fingerprint.json read/write with schema validation"
git push
```

---

## Task 4: Workflow resolution from fingerprints

**Files:**
- Create: `src/federation/workflows.ts`
- Create: `tests/federation/workflows.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/federation/workflows.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/federation/workflows.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement workflow resolution**

Create `src/federation/workflows.ts`:
```typescript
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
  // Collect entry points per workflow name
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/federation/workflows.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/federation/workflows.ts tests/federation/workflows.test.ts
git commit -m "feat(federation): resolve workflows from declared entry points + edges"
git push
```

---

## Task 5: Merge — rebuild org graph from fingerprints

**Files:**
- Create: `src/federation/merge.ts`
- Create: `tests/federation/merge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/federation/merge.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeFederation } from '../../src/federation/merge.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function writeFp(dir: string, fp: RepoFingerprint): void {
  writeFileSync(
    path.join(dir, `${fp.repo.name}.json`),
    JSON.stringify(fp)
  );
}

function producer(name: string, topic: string): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'go', version: '1.22', build_tool: 'go' }],
    },
    exposes: [
      {
        type: 'kafka-topic',
        identifier: topic,
        role: 'producer',
        source: { path: 'main.go', line: 1 },
        detection_method: 'static',
        confidence: 'static',
      },
    ],
    consumes: [],
    workflows_declared: [{ name: 'flow', entry_point: true }],
  };
}

function consumer(name: string, topic: string): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'java', version: '17', build_tool: 'gradle' }],
    },
    exposes: [],
    consumes: [
      {
        type: 'kafka-topic',
        identifier: topic,
        role: 'consumer',
        source: { path: 'App.java', line: 1 },
        detection_method: 'static',
        confidence: 'static',
      },
    ],
  };
}

describe('mergeFederation', () => {
  let tmp: string;
  let fingerprintsDir: string;
  let graphDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-merge-'));
    fingerprintsDir = path.join(tmp, 'fingerprints');
    graphDir = path.join(tmp, 'graph');
    mkdirSync(fingerprintsDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('produces services.json with all fingerprinted services', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    const result = mergeFederation({ fingerprintsDir, graphDir });
    expect(result.changed).toBe(true);
    expect(existsSync(path.join(graphDir, 'services.json'))).toBe(true);
    const services = JSON.parse(
      readFileSync(path.join(graphDir, 'services.json'), 'utf-8')
    );
    expect(services.services).toHaveLength(2);
  });

  it('produces edges.json with cross-repo edge', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    mergeFederation({ fingerprintsDir, graphDir });
    const edges = JSON.parse(
      readFileSync(path.join(graphDir, 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
    expect(edges.edges[0].from).toBe('svc-a');
    expect(edges.edges[0].to).toBe('svc-b');
  });

  it('produces workflows.json from declared entry points', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    mergeFederation({ fingerprintsDir, graphDir });
    const wf = JSON.parse(
      readFileSync(path.join(graphDir, 'workflows.json'), 'utf-8')
    );
    expect(wf.workflows).toHaveLength(1);
    expect(wf.workflows[0].name).toBe('flow');
    expect(wf.workflows[0].services.sort()).toEqual(['svc-a', 'svc-b']);
  });

  it('is idempotent: second run with same inputs reports changed=false', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    mergeFederation({ fingerprintsDir, graphDir });
    const second = mergeFederation({ fingerprintsDir, graphDir });
    expect(second.changed).toBe(false);
  });

  it('skips invalid fingerprints but keeps going', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFileSync(
      path.join(fingerprintsDir, 'bad.json'),
      '{"schema_version":"1.0"}'
    );
    const result = mergeFederation({ fingerprintsDir, graphDir });
    expect(result.skipped).toContain('bad.json');
    const services = JSON.parse(
      readFileSync(path.join(graphDir, 'services.json'), 'utf-8')
    );
    expect(services.services).toHaveLength(1);
  });

  it('normalizes identifiers so env-prefixed topics still match', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'prod.orders.new.v1'));
    writeFp(fingerprintsDir, consumer('svc-b', 'dev.orders.new.v2'));

    mergeFederation({ fingerprintsDir, graphDir });
    const edges = JSON.parse(
      readFileSync(path.join(graphDir, 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/federation/merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement merge**

Create `src/federation/merge.ts`:
```typescript
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { RepoFingerprint } from '../fingerprint/types.js';
import { isValidFingerprint } from '../fingerprint/schema.js';
import { buildGraph } from '../graph/builder.js';
import { writeGraph } from '../graph/writer.js';
import { resolveWorkflows } from './workflows.js';

export interface MergeOptions {
  fingerprintsDir: string;
  graphDir: string;
}

export interface MergeResult {
  changed: boolean;
  merged: string[];
  skipped: string[];
}

export function mergeFederation(opts: MergeOptions): MergeResult {
  const fingerprints: RepoFingerprint[] = [];
  const merged: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(opts.fingerprintsDir)) {
    throw new Error(
      `Fingerprints directory does not exist: ${opts.fingerprintsDir}`
    );
  }

  const files = readdirSync(opts.fingerprintsDir).filter((f) =>
    f.endsWith('.json')
  );
  for (const file of files) {
    const fullPath = path.join(opts.fingerprintsDir, file);
    try {
      const parsed = JSON.parse(readFileSync(fullPath, 'utf-8'));
      if (!isValidFingerprint(parsed)) {
        skipped.push(file);
        continue;
      }
      fingerprints.push(parsed);
      merged.push(file);
    } catch {
      skipped.push(file);
    }
  }

  const graph = buildGraph(fingerprints);
  const workflows = resolveWorkflows(fingerprints, graph.edges);

  // Build output dir one level above graphDir — writeGraph creates its own
  // `graph/` subdir, so pass the parent path.
  const outputParent = path.dirname(opts.graphDir);
  mkdirSync(outputParent, { recursive: true });

  // Compute new workflows content so we can diff against existing.
  const newWorkflowsJson = JSON.stringify(
    { schema_version: '2.0', workflows },
    null,
    2
  );
  const workflowsPath = path.join(opts.graphDir, 'workflows.json');

  // Detect whether anything will actually change.
  const servicesPath = path.join(opts.graphDir, 'services.json');
  const edgesPath = path.join(opts.graphDir, 'edges.json');
  const newServicesJson = JSON.stringify(
    { schema_version: graph.schema_version, services: graph.services },
    null,
    2
  );
  const newEdgesJson = JSON.stringify(
    { schema_version: graph.schema_version, edges: graph.edges },
    null,
    2
  );

  const prevServices = existsSync(servicesPath)
    ? readFileSync(servicesPath, 'utf-8')
    : '';
  const prevEdges = existsSync(edgesPath)
    ? readFileSync(edgesPath, 'utf-8')
    : '';
  const prevWorkflows = existsSync(workflowsPath)
    ? readFileSync(workflowsPath, 'utf-8')
    : '';

  const changed =
    prevServices !== newServicesJson ||
    prevEdges !== newEdgesJson ||
    prevWorkflows !== newWorkflowsJson;

  if (changed) {
    writeGraph(graph, outputParent);
    writeFileSync(workflowsPath, newWorkflowsJson, 'utf-8');
  }

  return { changed, merged, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/federation/merge.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/federation/merge.ts tests/federation/merge.test.ts
git commit -m "feat(federation): merge — rebuild org graph from fingerprints, idempotent"
git push
```

---

## Task 6: Git federation client (clone/pull/commit/push)

**Files:**
- Create: `src/federation/types.ts`
- Create: `src/federation/git-client.ts`
- Create: `tests/federation/git-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/federation/git-client.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitFederationClient } from '../../src/federation/git-client.js';
import { spawnGit } from '../../src/federation/git.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function makeBareRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await spawnGit(['init', '--bare', '--initial-branch=main'], {
    cwd: dir,
    throwOnError: true,
  });
}

async function seedInitialCommit(
  bareUrl: string,
  workDir: string
): Promise<void> {
  mkdirSync(workDir, { recursive: true });
  await spawnGit(['clone', bareUrl, '.'], { cwd: workDir, throwOnError: true });
  writeFileSync(path.join(workDir, 'README.md'), '# federation\n');
  await spawnGit(['add', '.'], { cwd: workDir, throwOnError: true });
  await spawnGit(
    ['-c', 'user.email=ci@code-wiki', '-c', 'user.name=ci', 'commit', '-m', 'init'],
    { cwd: workDir, throwOnError: true }
  );
  await spawnGit(['push', 'origin', 'main'], {
    cwd: workDir,
    throwOnError: true,
  });
}

describe('GitFederationClient', () => {
  let tmp: string;
  let bareDir: string;
  let bareUrl: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-gitclient-'));
    bareDir = path.join(tmp, 'bare.git');
    bareUrl = `file://${bareDir}`;
    await makeBareRepo(bareDir);
    await seedInitialCommit(bareUrl, path.join(tmp, 'seed'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ensureClone clones when local dir is empty', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);
    expect(existsSync(path.join(local, 'README.md'))).toBe(true);
  });

  it('ensureClone is idempotent: second call is a pull', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);
    await client.ensureClone(local); // should not throw
    expect(existsSync(path.join(local, 'README.md'))).toBe(true);
  });

  it('commitAndPush with publish_strategy=direct pushes to main', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    // Modify
    writeFileSync(path.join(local, 'hello.txt'), 'hi\n');

    const result = await client.commitAndPush(local, 'add hello.txt');
    expect(result.pushed).toBe(true);
    expect(result.branch).toBe('main');

    // Re-clone a fresh copy and verify the file is there
    const verify = path.join(tmp, 'verify');
    await spawnGit(['clone', bareUrl, '.'], {
      cwd: (mkdirSync(verify, { recursive: true }), verify),
      throwOnError: true,
    });
    expect(
      readFileSync(path.join(verify, 'hello.txt'), 'utf-8').trim()
    ).toBe('hi');
  });

  it('commitAndPush with publish_strategy=branch pushes a fingerprint branch', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'branch',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    writeFileSync(path.join(local, 'fingerprints.txt'), 'content\n');
    const result = await client.commitAndPush(
      local,
      'publish fingerprint for svc-a',
      'fingerprint/svc-a-abc123'
    );
    expect(result.pushed).toBe(true);
    expect(result.branch).toBe('fingerprint/svc-a-abc123');

    // The branch should exist in the bare repo
    const lsRemote = await spawnGit(['ls-remote', bareUrl], {
      cwd: tmp,
      throwOnError: true,
    });
    expect(lsRemote.stdout).toContain('refs/heads/fingerprint/svc-a-abc123');
  });

  it('commitAndPush with no changes returns pushed=false', async () => {
    const client = new GitFederationClient({
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    });
    const local = path.join(tmp, 'local-clone');
    await client.ensureClone(local);

    const result = await client.commitAndPush(local, 'no changes');
    expect(result.pushed).toBe(false);
  });
}, 30000);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/federation/git-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FederationClient types + GitFederationClient**

Create `src/federation/types.ts`:
```typescript
import type { FederationConfig } from '../config/schema.js';
export type { FederationConfig };

export interface FederationClient {
  ensureClone(localDir: string): Promise<void>;
  pullLatest(localDir: string): Promise<void>;
  commitAndPush(
    localDir: string,
    message: string,
    branch?: string
  ): Promise<{ pushed: boolean; branch: string }>;
}
```

Create `src/federation/git-client.ts`:
```typescript
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnGit } from './git.js';
import type { FederationClient, FederationConfig } from './types.js';

const GIT_AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'code-wiki',
  GIT_AUTHOR_EMAIL: 'code-wiki@local',
  GIT_COMMITTER_NAME: 'code-wiki',
  GIT_COMMITTER_EMAIL: 'code-wiki@local',
};

export class GitFederationClient implements FederationClient {
  constructor(private readonly config: FederationConfig) {}

  async ensureClone(localDir: string): Promise<void> {
    if (existsSync(path.join(localDir, '.git'))) {
      await this.pullLatest(localDir);
      return;
    }
    await spawnGit(
      ['clone', '--branch', this.config.branch, this.config.url, localDir],
      { cwd: path.dirname(localDir), throwOnError: true }
    );
  }

  async pullLatest(localDir: string): Promise<void> {
    await spawnGit(['fetch', 'origin', this.config.branch], {
      cwd: localDir,
      throwOnError: true,
    });
    await spawnGit(['checkout', this.config.branch], {
      cwd: localDir,
      throwOnError: true,
    });
    await spawnGit(['reset', '--hard', `origin/${this.config.branch}`], {
      cwd: localDir,
      throwOnError: true,
    });
  }

  async commitAndPush(
    localDir: string,
    message: string,
    branchOverride?: string
  ): Promise<{ pushed: boolean; branch: string }> {
    const targetBranch =
      branchOverride ??
      (this.config.publish_strategy === 'direct' ? this.config.branch : null);

    if (!targetBranch) {
      throw new Error(
        'commitAndPush: publish_strategy=branch requires a branch name'
      );
    }

    // Check if anything is staged-or-unstaged-different
    const status = await spawnGit(['status', '--porcelain'], {
      cwd: localDir,
      throwOnError: true,
    });
    if (status.stdout.trim().length === 0) {
      return { pushed: false, branch: targetBranch };
    }

    // Switch to target branch (create if needed for publish_strategy=branch)
    if (this.config.publish_strategy === 'branch' && branchOverride) {
      await spawnGit(['checkout', '-B', targetBranch], {
        cwd: localDir,
        throwOnError: true,
      });
    }

    await spawnGit(['add', '-A'], { cwd: localDir, throwOnError: true });
    await spawnGit(['commit', '-m', message], {
      cwd: localDir,
      throwOnError: true,
      env: GIT_AUTHOR_ENV,
    });
    await spawnGit(['push', 'origin', targetBranch], {
      cwd: localDir,
      throwOnError: true,
    });
    return { pushed: true, branch: targetBranch };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/federation/git-client.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/federation/types.ts src/federation/git-client.ts tests/federation/git-client.test.ts
git commit -m "feat(federation): GitFederationClient — clone/pull/commit/push"
git push
```

---

## Task 7: publish + pull orchestrators

**Files:**
- Create: `src/federation/publish.ts`
- Create: `src/federation/pull.ts`

No new tests for this task — the integration test in Task 9 exercises both end-to-end.

- [ ] **Step 1: Implement publish**

Create `src/federation/publish.ts`:
```typescript
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import type { RepoFingerprint } from '../fingerprint/types.js';
import type { FederationConfig } from './types.js';
import { GitFederationClient } from './git-client.js';
import { writeFingerprint } from './fingerprint-io.js';

export interface PublishOptions {
  fingerprint: RepoFingerprint;
  config: FederationConfig;
  commitSha?: string;
}

export interface PublishResult {
  pushed: boolean;
  branch: string;
  fingerprint_file: string;
}

export async function publishFingerprint(
  opts: PublishOptions
): Promise<PublishResult> {
  const client = new GitFederationClient(opts.config);
  const workTree = mkdtempSync(path.join(os.tmpdir(), 'code-wiki-publish-'));
  await client.ensureClone(workTree);

  // Write into fingerprints/<name>.json
  const fpDir = path.join(workTree, 'fingerprints');
  // Ensure directory exists (mkdir -p equivalent)
  const { mkdirSync } = await import('node:fs');
  mkdirSync(fpDir, { recursive: true });
  const target = writeFingerprint(fpDir, opts.fingerprint);

  const message = `publish fingerprint for ${opts.fingerprint.repo.name}`;
  const branch =
    opts.config.publish_strategy === 'branch'
      ? `fingerprint/${opts.fingerprint.repo.name}-${opts.commitSha ?? Date.now()}`
      : undefined;
  const result = await client.commitAndPush(workTree, message, branch);

  return {
    pushed: result.pushed,
    branch: result.branch,
    fingerprint_file: path.relative(workTree, target),
  };
}
```

- [ ] **Step 2: Implement pull**

Create `src/federation/pull.ts`:
```typescript
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import type { FederationConfig } from './types.js';
import { GitFederationClient } from './git-client.js';

export interface PullOptions {
  config: FederationConfig;
  localDir?: string; // defaults to ~/.code-wiki/org
}

export interface PullResult {
  localDir: string;
}

export async function pullFederation(
  opts: PullOptions
): Promise<PullResult> {
  const localDir =
    opts.localDir ?? path.join(os.homedir(), '.code-wiki', 'org');
  mkdirSync(path.dirname(localDir), { recursive: true });

  const client = new GitFederationClient(opts.config);
  await client.ensureClone(localDir);
  return { localDir };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/federation/publish.ts src/federation/pull.ts
git commit -m "feat(federation): publish + pull orchestrators"
git push
```

---

## Task 8: CLI wiring + MCP graph-path discovery

**Files:**
- Modify: `bin/code-wiki.ts` (add publish / pull / merge subcommands)
- Modify: `src/mcp/paths.ts` (add federation candidate)
- Modify: `tests/mcp/paths.test.ts`
- Modify: `src/mcp/tools/workflows.ts` (real implementation)
- Modify: `tests/mcp/tools/workflows.test.ts`
- Modify: `src/mcp/graph-reader.ts` (load workflows.json if present)

- [ ] **Step 1: Add failing test for federation candidate in paths**

Open `tests/mcp/paths.test.ts`. Append this test to the existing describe block:

```typescript
  it('falls back to ~/.code-wiki/org/graph/ when present and the other paths are not', () => {
    const homeLike = path.join(tmp, 'fake-home');
    const orgGraph = path.join(homeLike, '.code-wiki', 'org', 'graph');
    mkdirSync(orgGraph, { recursive: true });
    writeFileSync(path.join(orgGraph, 'services.json'), '{}');

    const result = discoverGraphPath({
      cwd: tmp,
      env: {},
      homeDir: homeLike,
    });
    expect(result).toBe(orgGraph);
  });
```

- [ ] **Step 2: Extend discoverGraphPath to accept homeDir + add federation candidate**

Open `src/mcp/paths.ts`. Update the signature and logic:

```typescript
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface DiscoverOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir?: string;
}

export function discoverGraphPath(opts: DiscoverOptions): string | null {
  const candidates: string[] = [];

  const envOverride = opts.env.CODE_WIKI_GRAPH;
  if (envOverride) candidates.push(envOverride);

  candidates.push(path.join(opts.cwd, 'docs', 'wiki', 'graph'));
  candidates.push(path.join(opts.cwd, 'code-wiki-output', 'graph'));

  const home = opts.homeDir ?? os.homedir();
  candidates.push(path.join(home, '.code-wiki', 'org', 'graph'));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'services.json'))) {
      return candidate;
    }
  }
  return null;
}
```

- [ ] **Step 3: Run paths tests to verify all pass**

Run: `npx vitest run tests/mcp/paths.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 4: Update GraphReader to expose workflows.json**

Open `src/mcp/graph-reader.ts`. Add a `_workflows` field, load it in `refresh()`, and expose a `workflows()` method:

At the top, add the interface:
```typescript
export interface WorkflowEntry {
  name: string;
  entry_points: string[];
  services: string[];
  edges: string[];
}
```

Add a private field: `private _workflows: WorkflowEntry[] = [];`

In `refresh()`, after loading matrix, add:
```typescript
    const workflowsPath = path.join(this.graphDir, 'workflows.json');
    if (existsSync(workflowsPath)) {
      const raw = JSON.parse(
        readFileSync(workflowsPath, 'utf-8')
      ) as { workflows?: WorkflowEntry[] };
      this._workflows = raw.workflows ?? [];
    } else {
      this._workflows = [];
    }
```

Expose an accessor:
```typescript
  workflows(): WorkflowEntry[] {
    return this._workflows;
  }
```

- [ ] **Step 5: Update MCP workflow tools to read real data**

Open `tests/mcp/tools/workflows.test.ts`. Update the tests to cover the real implementation:

Replace the entire file with:
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

function writeGraph(graphDir: string, withWorkflow: boolean): void {
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(
    path.join(graphDir, 'services.json'),
    JSON.stringify({ schema_version: '2.0', services: [] })
  );
  if (withWorkflow) {
    writeFileSync(
      path.join(graphDir, 'workflows.json'),
      JSON.stringify({
        schema_version: '2.0',
        workflows: [
          {
            name: 'order-placement',
            entry_points: ['svc-a'],
            services: ['svc-a', 'svc-b'],
            edges: ['e001'],
          },
        ],
      })
    );
  }
}

describe('workflow tools', () => {
  let tmp: string;
  let reader: GraphReader;

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('with workflows.json present', () => {
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
      const graphDir = path.join(tmp, 'graph');
      writeGraph(graphDir, true);
      reader = new GraphReader(graphDir);
    });

    it('list_workflows returns declared workflows', async () => {
      const res = await listWorkflowsTool.handler(
        {},
        { reader, cwd: tmp }
      );
      const data = res.data as { workflows: Array<{ name: string }> };
      expect(data.workflows).toHaveLength(1);
      expect(data.workflows[0].name).toBe('order-placement');
    });

    it('get_workflow returns the matching workflow', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'order-placement' },
        { reader, cwd: tmp }
      );
      const data = res.data as {
        workflow: { services: string[] } | null;
      };
      expect(data.workflow).not.toBeNull();
      expect(data.workflow!.services.sort()).toEqual(['svc-a', 'svc-b']);
    });

    it('get_workflow returns null for unknown name', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'does-not-exist' },
        { reader, cwd: tmp }
      );
      const data = res.data as { workflow: null; not_found: true };
      expect(data.workflow).toBeNull();
      expect(data.not_found).toBe(true);
    });
  });

  describe('without workflows.json', () => {
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
      const graphDir = path.join(tmp, 'graph');
      writeGraph(graphDir, false);
      reader = new GraphReader(graphDir);
    });

    it('list_workflows returns empty list (no error)', async () => {
      const res = await listWorkflowsTool.handler(
        {},
        { reader, cwd: tmp }
      );
      const data = res.data as { workflows: unknown[] };
      expect(data.workflows).toEqual([]);
    });

    it('get_workflow returns null', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'anything' },
        { reader, cwd: tmp }
      );
      const data = res.data as { workflow: null };
      expect(data.workflow).toBeNull();
    });
  });
});
```

Replace the entire contents of `src/mcp/tools/workflows.ts` with:
```typescript
import type { McpTool } from './index.js';
import { buildResponse } from '../response.js';

export const listWorkflowsTool: McpTool = {
  name: 'list_workflows',
  description:
    'List named workflows across the graph. Each workflow has entry points, member services, and the edges that form it.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: {
        workflows: reader.workflows().map((w) => ({
          name: w.name,
          entry_points: w.entry_points,
          service_count: w.services.length,
          edge_count: w.edges.length,
        })),
      },
      confidence: 'static',
    }),
};

export const getWorkflowTool: McpTool = {
  name: 'get_workflow',
  description:
    'Get the full service list + edge ids for a named workflow.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const name = args.name as string;
    const workflow = reader.workflows().find((w) => w.name === name);
    if (!workflow) {
      return buildResponse(reader, {
        data: { workflow: null, not_found: true },
        confidence: 'static',
      });
    }
    return buildResponse(reader, {
      data: { workflow },
      confidence: 'static',
    });
  },
};
```

- [ ] **Step 6: Run MCP tests to verify they pass**

Run: `npx vitest run tests/mcp/`
Expected: all MCP tests pass.

- [ ] **Step 7: Wire publish/pull/merge CLI subcommands**

Open `bin/code-wiki.ts`. Add these imports:
```typescript
import { AdapterRegistry } from '../src/adapters/registry.js';
import { fingerprintRepo } from '../src/scanner/fingerprint.js';
import { publishFingerprint } from '../src/federation/publish.js';
import { pullFederation } from '../src/federation/pull.js';
import { mergeFederation } from '../src/federation/merge.js';
```

Add three new subcommands (put them near the other commands, before `program.parse()`):

```typescript
program
  .command('publish')
  .description('Publish this repo\'s fingerprint to the federation repo')
  .option('-p, --path <path>', 'Path to the repo to scan', process.cwd())
  .option('-c, --config <config>', 'Path to code-wiki.yaml', 'code-wiki.yaml')
  .action(async (options: { path: string; config: string }) => {
    const config = loadConfig(options.config);
    if (!config.federation?.enabled) {
      console.error('federation is not enabled in code-wiki.yaml');
      process.exit(1);
    }
    const registry = AdapterRegistry.withBuiltins();
    const fingerprint = await fingerprintRepo(path.resolve(options.path), registry);
    const result = await publishFingerprint({
      fingerprint,
      config: config.federation,
      commitSha: fingerprint.repo.sha,
    });
    console.log(
      `published ${result.fingerprint_file} → branch ${result.branch} (pushed=${result.pushed})`
    );
  });

program
  .command('pull')
  .description('Clone or update the federation repo under ~/.code-wiki/org/')
  .option('-c, --config <config>', 'Path to code-wiki.yaml', 'code-wiki.yaml')
  .action(async (options: { config: string }) => {
    const config = loadConfig(options.config);
    if (!config.federation?.enabled) {
      console.error('federation is not enabled in code-wiki.yaml');
      process.exit(1);
    }
    const result = await pullFederation({ config: config.federation });
    console.log(`federation repo at: ${result.localDir}`);
  });

program
  .command('merge')
  .description('Rebuild the org graph from all fingerprints (runs inside the federation repo)')
  .option('-d, --dir <dir>', 'Federation repo root', process.cwd())
  .action(async (options: { dir: string }) => {
    const root = path.resolve(options.dir);
    const fingerprintsDir = path.join(root, 'fingerprints');
    const graphDir = path.join(root, 'graph');
    const result = mergeFederation({ fingerprintsDir, graphDir });
    console.log(
      `merge: ${result.merged.length} fingerprints merged, ${result.skipped.length} skipped, changed=${result.changed}`
    );
  });
```

- [ ] **Step 8: Typecheck + all tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/mcp/paths.ts src/mcp/graph-reader.ts src/mcp/tools/workflows.ts tests/mcp/paths.test.ts tests/mcp/tools/workflows.test.ts bin/code-wiki.ts
git commit -m "feat(federation): CLI publish/pull/merge + MCP reads real workflows"
git push
```

---

## Task 9: End-to-end integration test

**Files:**
- Create: `tests/federation/publish-pull-merge.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/federation/publish-pull-merge.integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { publishFingerprint } from '../../src/federation/publish.js';
import { pullFederation } from '../../src/federation/pull.js';
import { mergeFederation } from '../../src/federation/merge.js';
import { spawnGit } from '../../src/federation/git.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import type { FederationConfig } from '../../src/federation/types.js';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function fp(
  name: string,
  kind: 'producer' | 'consumer',
  topic: string
): RepoFingerprint {
  const role = kind === 'producer' ? 'producer' : 'consumer';
  const entries = [
    {
      type: 'kafka-topic' as const,
      identifier: topic,
      role: role as 'producer' | 'consumer',
      source: { path: 'app.yaml', line: 1 },
      detection_method: 'static' as const,
      confidence: 'static' as const,
    },
  ];
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'go', version: '1.22', build_tool: 'go' }],
    },
    exposes: kind === 'producer' ? entries : [],
    consumes: kind === 'consumer' ? entries : [],
    workflows_declared:
      kind === 'producer' ? [{ name: 'flow', entry_point: true }] : undefined,
  };
}

describe('federation publish → merge → read', () => {
  let tmp: string;
  let bareUrl: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-fedit-'));
    const bareDir = path.join(tmp, 'bare.git');
    bareUrl = `file://${bareDir}`;
    mkdirSync(bareDir, { recursive: true });
    await spawnGit(['init', '--bare', '--initial-branch=main'], {
      cwd: bareDir,
      throwOnError: true,
    });

    // Seed an initial commit so `clone --branch main` works
    const seed = path.join(tmp, 'seed');
    mkdirSync(seed, { recursive: true });
    await spawnGit(['clone', bareUrl, '.'], { cwd: seed, throwOnError: true });
    mkdirSync(path.join(seed, 'fingerprints'), { recursive: true });
    await spawnGit(['add', '-A'], { cwd: seed, throwOnError: true });
    await spawnGit(
      [
        '-c', 'user.email=ci@code-wiki',
        '-c', 'user.name=ci',
        'commit', '--allow-empty', '-m', 'init',
      ],
      { cwd: seed, throwOnError: true }
    );
    await spawnGit(['push', 'origin', 'main'], {
      cwd: seed,
      throwOnError: true,
    });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('publish → pull → merge produces a cross-repo edge', async () => {
    const config: FederationConfig = {
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    };

    await publishFingerprint({
      fingerprint: fp('svc-a', 'producer', 'orders.new'),
      config,
    });
    await publishFingerprint({
      fingerprint: fp('svc-b', 'consumer', 'orders.new'),
      config,
    });

    const local = path.join(tmp, 'org-clone');
    await pullFederation({ config, localDir: local });

    const merge = mergeFederation({
      fingerprintsDir: path.join(local, 'fingerprints'),
      graphDir: path.join(local, 'graph'),
    });

    expect(merge.merged.length).toBe(2);

    const edges = JSON.parse(
      readFileSync(path.join(local, 'graph', 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
    expect(edges.edges[0].from).toBe('svc-a');
    expect(edges.edges[0].to).toBe('svc-b');

    const workflows = JSON.parse(
      readFileSync(path.join(local, 'graph', 'workflows.json'), 'utf-8')
    );
    expect(workflows.workflows).toHaveLength(1);
    expect(workflows.workflows[0].services.sort()).toEqual(['svc-a', 'svc-b']);
  });
}, 30000);
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/federation/publish-pull-merge.integration.test.ts`
Expected: test PASSES.

- [ ] **Step 3: Run the FULL suite one last time**

Run: `npx vitest run`
Expected: all tests PASS. Total should be 140+.

- [ ] **Step 4: Commit**

```bash
git add tests/federation/publish-pull-merge.integration.test.ts
git commit -m "feat(federation): end-to-end publish→pull→merge integration test"
git push
```

---

## Summary

| Task | Component | Tests | Commits |
|------|-----------|-------|---------|
| 1 | Federation config schema | 2 | 1 |
| 2 | spawnGit (argv-only) | 4 | 1 |
| 3 | fingerprint.json read/write | 5 | 1 |
| 4 | Workflow resolution | 4 | 1 |
| 5 | Merge job | 6 | 1 |
| 6 | GitFederationClient | 5 | 1 |
| 7 | publish + pull orchestrators | 0 | 1 |
| 8 | CLI + MCP wiring | ~5 new/updated | 1 |
| 9 | End-to-end integration test | 1 | 1 |

**Total:** ~32 new/updated tests, 9 commits, no release tag (2d + 2e ship v0.4.0).

## What slice 2d does NOT ship

- Skill generation (slice 2e) — per-workflow Claude Code skills.
- `narrate` LLM pass — slice 2f.
- Signed commits / CODEOWNERS setup — users configure on the federation repo themselves.
- Non-git federation (S3 / HTTP service) — deferred.
- Authentication via PATs beyond SSH/env-var pattern — users provide via git credential helper.
