# Phase 2a — Schema v2.0 + Scanner Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the fingerprint/graph schema from v1.0 to v2.0, introducing first-class `exposes` / `consumes` arrays with per-identifier source evidence, plus a new REST adapter that detects Go chi routes. This is slice 2a of Phase 2 — it produces `v0.2.0` and unblocks every other slice.

**Architecture:** Adds a new `src/fingerprint/` module that owns the v2.0 schema types, schema version constants, and identifier normalization rules. The existing `CodeWikiAdapter` interface gains an optional `findExposures()` method that returns `Exposure[]` with file+line evidence. The Kafka adapter gains line tracking; a new `RestAdapter` detects Go chi routes as the seed framework (Express/Spring deferred). The scanner aggregates each adapter's exposures into the v2.0 fingerprint shape, splitting them into `exposes` (producer / server / both roles) and `consumes` (consumer / client roles). The graph builder switches from topic-only matching to identifier-typed matching via normalized keys.

**Tech Stack:** TypeScript 5.x, Node.js 22+, Vitest, fast-glob, yaml.

---

## File Structure

```
code-wiki/
├── src/
│   ├── fingerprint/                     # NEW module
│   │   ├── types.ts                     # v2.0 schema types
│   │   ├── schema.ts                    # SCHEMA_VERSION + validation
│   │   └── normalize.ts                 # identifier normalization rules
│   ├── adapters/
│   │   ├── types.ts                     # MODIFY — add Exposure type + findExposures()
│   │   ├── registry.ts                  # MODIFY — register RestAdapter
│   │   └── communication/
│   │       ├── kafka.ts                 # MODIFY — emit Exposure[] with line numbers
│   │       └── rest.ts                  # NEW — REST endpoint detection (Go chi)
│   ├── scanner/
│   │   ├── types.ts                     # MODIFY — re-export v2.0 RepoFingerprint
│   │   └── fingerprint.ts               # MODIFY — aggregate exposures into v2.0
│   └── graph/
│       ├── types.ts                     # MODIFY — ServiceNode.exposes/consumes: Exposure[]
│       ├── builder.ts                   # MODIFY — match exposes ↔ consumes with normalization
│       └── writer.ts                    # MODIFY — v2.0 schema_version in outputs
├── tests/
│   ├── fingerprint/
│   │   ├── schema.test.ts               # NEW
│   │   └── normalize.test.ts            # NEW
│   ├── adapters/
│   │   ├── kafka.test.ts                # MODIFY — assert source evidence
│   │   └── rest.test.ts                 # NEW
│   ├── scanner/
│   │   └── fingerprint.test.ts          # MODIFY — v2.0 assertions
│   ├── graph/
│   │   ├── builder.test.ts              # MODIFY — exposes/consumes matching
│   │   └── writer.test.ts               # MODIFY — schema_version: "2.0"
│   └── fixtures/repos/
│       └── go-rest-service/             # NEW
│           ├── go.mod
│           └── cmd/server/router.go
└── package.json                         # MODIFY — version 0.2.0
```

### Key type definitions (used throughout this plan)

```typescript
// src/fingerprint/types.ts
export interface SourceEvidence {
  path: string;            // relative to repo root
  line?: number;           // 1-indexed
}

export interface Exposure {
  type: 'kafka-topic' | 'rest-endpoint' | 'grpc-service' | 'db-schema';
  identifier: string;      // e.g., "orders.new", "POST /orders"
  role: 'producer' | 'consumer' | 'both' | 'server' | 'client';
  source: SourceEvidence;
  detection_method: 'static' | 'annotated' | 'inferred';
  confidence: 'static' | 'inferred';
}

export interface LanguageInfo {
  language: string;
  version?: string;
  build_tool?: string;
  dependencies?: Array<{ name: string; version: string; scope?: string }>;
}

export interface RepoFingerprint {
  schema_version: '2.0';
  repo: {
    name: string;
    path: string;
    remote?: string;
    branch?: string;
    sha?: string;
  };
  scanned_at: string;
  tech_stack: {
    languages: LanguageInfo[];
  };
  exposes: Exposure[];
  consumes: Exposure[];
  workflows_declared?: Array<{ name: string; entry_point?: boolean }>;
}
```

---

## Task 1: Fingerprint schema types + schema version

**Files:**
- Create: `src/fingerprint/types.ts`
- Create: `src/fingerprint/schema.ts`
- Create: `tests/fingerprint/schema.test.ts`

- [ ] **Step 1: Write the failing test for schema constants**

Create `tests/fingerprint/schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, isValidFingerprint } from '../../src/fingerprint/schema.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';

describe('fingerprint schema', () => {
  it('SCHEMA_VERSION is "2.0"', () => {
    expect(SCHEMA_VERSION).toBe('2.0');
  });

  it('isValidFingerprint accepts a well-formed v2.0 fingerprint', () => {
    const fp: RepoFingerprint = {
      schema_version: '2.0',
      repo: { name: 'svc-a', path: '/repos/svc-a' },
      scanned_at: '2026-04-12T10:00:00Z',
      tech_stack: { languages: [{ language: 'go', version: '1.22' }] },
      exposes: [],
      consumes: [],
    };
    expect(isValidFingerprint(fp)).toBe(true);
  });

  it('isValidFingerprint rejects missing schema_version', () => {
    expect(isValidFingerprint({} as unknown)).toBe(false);
  });

  it('isValidFingerprint rejects wrong schema_version', () => {
    expect(
      isValidFingerprint({
        schema_version: '1.0',
        repo: { name: 'x', path: '/x' },
        scanned_at: '',
        tech_stack: { languages: [] },
        exposes: [],
        consumes: [],
      } as unknown)
    ).toBe(false);
  });

  it('isValidFingerprint rejects missing exposes/consumes arrays', () => {
    expect(
      isValidFingerprint({
        schema_version: '2.0',
        repo: { name: 'x', path: '/x' },
        scanned_at: '',
        tech_stack: { languages: [] },
      } as unknown)
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fingerprint/schema.test.ts`
Expected: FAIL — `Cannot find module '../../src/fingerprint/schema.js'`.

- [ ] **Step 3: Create the types module**

Create `src/fingerprint/types.ts`:
```typescript
export interface SourceEvidence {
  path: string;
  line?: number;
}

export interface Exposure {
  type: 'kafka-topic' | 'rest-endpoint' | 'grpc-service' | 'db-schema';
  identifier: string;
  role: 'producer' | 'consumer' | 'both' | 'server' | 'client';
  source: SourceEvidence;
  detection_method: 'static' | 'annotated' | 'inferred';
  confidence: 'static' | 'inferred';
}

export interface LanguageInfo {
  language: string;
  version?: string;
  build_tool?: string;
  dependencies?: Array<{ name: string; version: string; scope?: string }>;
}

export interface RepoFingerprint {
  schema_version: '2.0';
  repo: {
    name: string;
    path: string;
    remote?: string;
    branch?: string;
    sha?: string;
  };
  scanned_at: string;
  tech_stack: {
    languages: LanguageInfo[];
  };
  exposes: Exposure[];
  consumes: Exposure[];
  workflows_declared?: Array<{ name: string; entry_point?: boolean }>;
}
```

- [ ] **Step 4: Create the schema module**

Create `src/fingerprint/schema.ts`:
```typescript
import type { RepoFingerprint } from './types.js';

export const SCHEMA_VERSION = '2.0' as const;

export function isValidFingerprint(
  value: unknown
): value is RepoFingerprint {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schema_version !== SCHEMA_VERSION) return false;
  if (!v.repo || typeof v.repo !== 'object') return false;
  const repo = v.repo as Record<string, unknown>;
  if (typeof repo.name !== 'string' || typeof repo.path !== 'string') {
    return false;
  }
  if (typeof v.scanned_at !== 'string') return false;
  if (!v.tech_stack || typeof v.tech_stack !== 'object') return false;
  if (!Array.isArray((v.tech_stack as { languages?: unknown }).languages)) {
    return false;
  }
  if (!Array.isArray(v.exposes) || !Array.isArray(v.consumes)) {
    return false;
  }
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/fingerprint/schema.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fingerprint/types.ts src/fingerprint/schema.ts tests/fingerprint/schema.test.ts
git commit -m "feat: fingerprint v2.0 schema types with exposes/consumes arrays"
```

---

## Task 2: Identifier normalization

**Files:**
- Create: `src/fingerprint/normalize.ts`
- Create: `tests/fingerprint/normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/fingerprint/normalize.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  normalizeKafkaTopic,
  normalizeRestPath,
  normalizeIdentifier,
} from '../../src/fingerprint/normalize.js';

describe('normalizeKafkaTopic', () => {
  it('lowercases and trims', () => {
    expect(normalizeKafkaTopic('  Orders.New  ')).toBe('orders.new');
  });

  it('strips environment prefixes', () => {
    expect(normalizeKafkaTopic('dev.orders.new')).toBe('orders.new');
    expect(normalizeKafkaTopic('prod.orders.new')).toBe('orders.new');
    expect(normalizeKafkaTopic('stg.orders.new')).toBe('orders.new');
  });

  it('strips version suffixes', () => {
    expect(normalizeKafkaTopic('orders.new.v1')).toBe('orders.new');
    expect(normalizeKafkaTopic('orders.new.v2')).toBe('orders.new');
  });

  it('strips env prefix and version suffix together', () => {
    expect(normalizeKafkaTopic('prod.orders.new.v2')).toBe('orders.new');
  });
});

describe('normalizeRestPath', () => {
  it('strips trailing slash', () => {
    expect(normalizeRestPath('GET /users/')).toBe('GET /users');
  });

  it('lowercases method, preserves path case', () => {
    expect(normalizeRestPath('get /Users')).toBe('GET /Users');
  });

  it('collapses named path params', () => {
    expect(normalizeRestPath('GET /users/{id}')).toBe('GET /users/:param');
    expect(normalizeRestPath('GET /users/:id')).toBe('GET /users/:param');
    expect(normalizeRestPath('GET /users/:id/orders/{orderId}')).toBe(
      'GET /users/:param/orders/:param'
    );
  });
});

describe('normalizeIdentifier', () => {
  it('dispatches on exposure type', () => {
    expect(normalizeIdentifier('kafka-topic', 'Prod.Orders.New.V1')).toBe(
      'orders.new'
    );
    expect(normalizeIdentifier('rest-endpoint', 'get /users/{id}/')).toBe(
      'GET /users/:param'
    );
  });

  it('returns unknown types untouched (trimmed + lowercased)', () => {
    expect(normalizeIdentifier('grpc-service', 'Foo.Bar/Baz ')).toBe(
      'foo.bar/baz'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fingerprint/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalization**

Create `src/fingerprint/normalize.ts`:
```typescript
const ENV_PREFIXES = ['dev.', 'prod.', 'stg.', 'staging.', 'qa.', 'test.'];
const VERSION_SUFFIX = /\.v\d+$/i;

export function normalizeKafkaTopic(raw: string): string {
  let s = raw.trim().toLowerCase();
  for (const prefix of ENV_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  s = s.replace(VERSION_SUFFIX, '');
  return s;
}

export function normalizeRestPath(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\w+)\s+(.+)$/);
  if (!match) return trimmed;

  const method = match[1].toUpperCase();
  let routePath = match[2];
  if (routePath.length > 1 && routePath.endsWith('/')) {
    routePath = routePath.slice(0, -1);
  }
  routePath = routePath.replace(/\{[^}]+\}/g, ':param');
  routePath = routePath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param');
  return `${method} ${routePath}`;
}

export function normalizeIdentifier(
  type: string,
  identifier: string
): string {
  if (type === 'kafka-topic') return normalizeKafkaTopic(identifier);
  if (type === 'rest-endpoint') return normalizeRestPath(identifier);
  return identifier.trim().toLowerCase();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fingerprint/normalize.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fingerprint/normalize.ts tests/fingerprint/normalize.test.ts
git commit -m "feat: identifier normalization rules for Kafka topics and REST paths"
```

---

## Task 3: Extend adapter interface with findExposures

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/scanner/types.ts`

- [ ] **Step 1: Extend adapter interface**

Open `src/adapters/types.ts`. Add the `Exposure` re-export and a new optional method on `CodeWikiAdapter`. Prepend this import at the top of the file:

```typescript
import type { Exposure, SourceEvidence } from '../fingerprint/types.js';
```

Add the re-export line at the bottom of the file:

```typescript
export type { Exposure, SourceEvidence };
```

Find the existing `CodeWikiAdapter` interface and add the new optional method (just before `findConnections`):

```typescript
export interface CodeWikiAdapter {
  name: string;
  type: AdapterType;
  filePatterns: string[];
  detect(repoPath: string): Promise<DetectionResult>;
  findExposures?(repoPath: string): Promise<Exposure[]>;
  findConnections?(
    repoPath: string,
    context: ConnectionContext
  ): Promise<EdgeCandidate[]>;
  healthCheck?(): Promise<{ healthy: boolean; message: string }>;
}
```

- [ ] **Step 2: Replace scanner/types.ts with a compatibility shim**

The v1 `RepoFingerprint` in `src/scanner/types.ts` is replaced by the v2.0 type. Replace the entire contents of `src/scanner/types.ts` with:

```typescript
export type { RepoFingerprint } from '../fingerprint/types.js';
```

This re-export keeps existing imports like `import type { RepoFingerprint } from '../scanner/types.js'` working while the source of truth now lives in `src/fingerprint/types.ts`.

- [ ] **Step 3: Typecheck compiles**

Run: `npx tsc --noEmit`
Expected: No errors from the new interface. **There will be errors from code that still uses the v1 fingerprint shape (tech_stack.languages + communication).** Those are fixed in later tasks — leave them for now.

Note: if `npx tsc --noEmit` reports more than 30 errors, stop and re-read this task for any misstep. A handful of errors in `src/scanner/fingerprint.ts`, `src/graph/builder.ts`, `src/graph/writer.ts`, and their tests are expected.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/types.ts src/scanner/types.ts
git commit -m "feat: add findExposures() to adapter interface + re-export v2.0 fingerprint"
```

---

## Task 4: Kafka adapter emits exposures with source evidence

**Files:**
- Modify: `src/adapters/communication/kafka.ts`
- Modify: `tests/adapters/kafka.test.ts`

- [ ] **Step 1: Update Kafka tests to assert source evidence**

Replace the body of `tests/adapters/kafka.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { KafkaAdapter } from '../../src/adapters/communication/kafka.js';
import type { Exposure } from '../../src/fingerprint/types.js';
import path from 'node:path';

const KAFKA_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'kafka-producer'
);
const TS_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'ts-service'
);
const CONFIGS_DIR = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'configs'
);

describe('KafkaAdapter', () => {
  const adapter = new KafkaAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('kafka');
    expect(adapter.type).toBe('communication');
  });

  it('detect() still reports detected=true for a Kafka repo', async () => {
    const result = await adapter.detect(KAFKA_REPO);
    expect(result.detected).toBe(true);
  });

  it('detect() reports detected=false for a non-Kafka repo', async () => {
    const result = await adapter.detect(CONFIGS_DIR);
    expect(result.detected).toBe(false);
  });

  it('findExposures returns kafka-topic entries with source evidence', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    expect(exposures.length).toBeGreaterThan(0);
    const identifiers = exposures.map((e) => e.identifier);
    expect(identifiers).toContain('credit.check.requests');
    expect(identifiers).toContain('credit.check.responses');
    expect(identifiers).toContain('credit.check.dlq');

    for (const ex of exposures) {
      expect(ex.type).toBe('kafka-topic');
      expect(ex.source.path).toMatch(/application\.yaml$/);
      expect(typeof ex.source.line === 'number' || ex.source.line === undefined).toBe(true);
      expect(['static', 'annotated', 'inferred']).toContain(ex.detection_method);
      expect(['static', 'inferred']).toContain(ex.confidence);
    }
  });

  it('findExposures attaches a line number for topics found via YAML', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    const defaultTopic = exposures.find(
      (e) => e.identifier === 'credit.check.requests'
    );
    expect(defaultTopic).toBeDefined();
    expect(typeof defaultTopic!.source.line).toBe('number');
    expect(defaultTopic!.source.line).toBeGreaterThan(0);
  });

  it('findExposures assigns role producer/consumer/both per topic', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    const roles = new Set(exposures.map((e) => e.role));
    // application.yaml has both a producer and consumer block
    expect([...roles].every((r) => ['producer', 'consumer', 'both'].includes(r))).toBe(true);
  });

  it('findExposures handles kafkajs-only TS repo (no YAML, no line)', async () => {
    const exposures: Exposure[] = await adapter.findExposures!(TS_REPO);
    expect(exposures.length).toBeGreaterThan(0);
    for (const ex of exposures) {
      expect(ex.source.path).toBe('package.json');
    }
  });

  it('findExposures returns [] for a non-Kafka repo', async () => {
    const exposures = await adapter.findExposures!(CONFIGS_DIR);
    expect(exposures).toEqual([]);
  });
});
```

Note: the TS kafkajs case has no obvious identifiers in `package.json`, so the implementation emits a single placeholder exposure indicating that the `kafkajs` library is present. The test above asserts that any exposures returned have `source.path === 'package.json'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/kafka.test.ts`
Expected: FAIL — `findExposures is not a function` (or similar — the method doesn't exist yet).

- [ ] **Step 3: Rewrite the Kafka adapter to emit exposures**

Replace the entire contents of `src/adapters/communication/kafka.ts` with:

```typescript
import { readFileSync, existsSync } from 'node:fs';
import glob from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import type {
  CodeWikiAdapter,
  CommunicationDetection,
  Exposure,
} from '../types.js';

interface TopicHit {
  topic: string;
  role: 'producer' | 'consumer' | 'both';
  line?: number;
}

export class KafkaAdapter implements CodeWikiAdapter {
  name = 'kafka' as const;
  type = 'communication' as const;
  filePatterns = [
    '**/application.yaml',
    '**/application.yml',
    '**/package.json',
  ];

  async detect(repoPath: string): Promise<CommunicationDetection> {
    const exposures = await this.findExposures(repoPath);
    if (exposures.length === 0) {
      return {
        detected: false,
        details: {
          type: 'kafka',
          role: 'both',
          identifiers: [],
          config_files: [],
        },
      };
    }

    const roles = new Set(exposures.map((e) => e.role));
    const hasProducer = roles.has('producer') || roles.has('both');
    const hasConsumer = roles.has('consumer') || roles.has('both');
    const role: CommunicationDetection['details']['role'] =
      hasProducer && hasConsumer
        ? 'both'
        : hasProducer
          ? 'producer'
          : 'consumer';

    return {
      detected: true,
      details: {
        type: 'kafka',
        role,
        identifiers: [...new Set(exposures.map((e) => e.identifier))],
        config_files: [...new Set(exposures.map((e) => e.source.path))],
      },
    };
  }

  async findExposures(repoPath: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    const springConfigs = await glob(
      [
        '**/application.yaml',
        '**/application.yml',
        '**/application*.yaml',
        '**/application*.yml',
      ],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/build/**', '**/target/**'],
      }
    );

    for (const configFile of springConfigs) {
      const rel = path.relative(repoPath, configFile);
      const hits = this.parseSpringKafkaConfig(configFile);
      for (const hit of hits) {
        exposures.push({
          type: 'kafka-topic',
          identifier: hit.topic,
          role: hit.role,
          source: { path: rel, line: hit.line },
          detection_method: 'static',
          confidence: 'static',
        });
      }
    }

    const packageJson = path.join(repoPath, 'package.json');
    if (existsSync(packageJson)) {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (
        'kafkajs' in allDeps ||
        '@confluentinc/kafka-javascript' in allDeps
      ) {
        // We detect Kafka use but cannot enumerate topics without code
        // inspection. Emit a placeholder exposure so federation still sees
        // "this service uses Kafka". Edges form only for named topics.
        exposures.push({
          type: 'kafka-topic',
          identifier: '<unknown>',
          role: 'both',
          source: { path: 'package.json' },
          detection_method: 'inferred',
          confidence: 'inferred',
        });
      }
    }

    return exposures;
  }

  private parseSpringKafkaConfig(filePath: string): TopicHit[] {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const hits: TopicHit[] = [];

    let hasProducer = false;
    let hasConsumer = false;

    try {
      const yaml = parseYaml(content) as Record<string, unknown>;
      const spring = yaml?.spring as Record<string, unknown> | undefined;
      const kafka = spring?.kafka as Record<string, unknown> | undefined;

      if (kafka?.producer) hasProducer = true;
      if (kafka?.consumer) hasConsumer = true;

      const roleOf = (): TopicHit['role'] =>
        hasProducer && hasConsumer
          ? 'both'
          : hasProducer
            ? 'producer'
            : hasConsumer
              ? 'consumer'
              : 'both';

      this.collectTopicsWithLines(yaml, lines, hits, roleOf, 0);
    } catch {
      // Fallback: loose regex scan line-by-line; line tracking is best-effort.
      const topicRegex = /topic[s]?\s*[:=]\s*['"]?([a-zA-Z0-9._-]+)/gi;
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(topicRegex)) {
          const candidate = m[1];
          if (
            candidate.includes('.') &&
            !candidate.startsWith('org.') &&
            !candidate.startsWith('io.')
          ) {
            hits.push({ topic: candidate, role: 'both', line: i + 1 });
          }
        }
      }
    }

    return hits;
  }

  private collectTopicsWithLines(
    obj: unknown,
    lines: string[],
    hits: TopicHit[],
    roleOf: () => TopicHit['role'],
    depth: number
  ): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const keyLower = key.toLowerCase();
        const looksLikeTopic =
          (keyLower.includes('topic') ||
            keyLower === 'dlq' ||
            keyLower === 'outbound' ||
            keyLower === 'inbound' ||
            keyLower === 'default-topic') &&
          value.includes('.') &&
          !value.startsWith('org.') &&
          !value.startsWith('io.') &&
          !value.startsWith('com.') &&
          !value.includes('/');

        if (looksLikeTopic) {
          hits.push({
            topic: value,
            role: roleOf(),
            line: findLineOfString(lines, value),
          });
        }
      } else if (typeof value === 'object' && value !== null) {
        this.collectTopicsWithLines(value, lines, hits, roleOf, depth + 1);
      }
    }
  }
}

function findLineOfString(lines: string[], needle: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/kafka.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/communication/kafka.ts tests/adapters/kafka.test.ts
git commit -m "feat: Kafka adapter emits Exposure[] with file:line evidence"
```

---

## Task 5: REST adapter + Go chi fixture

**Files:**
- Create: `src/adapters/communication/rest.ts`
- Create: `tests/adapters/rest.test.ts`
- Create: `tests/fixtures/repos/go-rest-service/go.mod`
- Create: `tests/fixtures/repos/go-rest-service/cmd/server/router.go`

- [ ] **Step 1: Create the Go chi fixture**

Create `tests/fixtures/repos/go-rest-service/go.mod`:
```
module github.com/example/order-gateway

go 1.22.3

require (
	github.com/go-chi/chi/v5 v5.1.0
)
```

Create `tests/fixtures/repos/go-rest-service/cmd/server/router.go`:
```go
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func NewRouter() http.Handler {
	r := chi.NewRouter()

	r.Get("/health", healthHandler)
	r.Post("/orders", createOrderHandler)
	r.Get("/orders/{id}", getOrderHandler)
	r.Put("/orders/{id}", updateOrderHandler)
	r.Delete("/orders/{id}", deleteOrderHandler)

	return r
}

func healthHandler(w http.ResponseWriter, r *http.Request)      {}
func createOrderHandler(w http.ResponseWriter, r *http.Request) {}
func getOrderHandler(w http.ResponseWriter, r *http.Request)    {}
func updateOrderHandler(w http.ResponseWriter, r *http.Request) {}
func deleteOrderHandler(w http.ResponseWriter, r *http.Request) {}
```

- [ ] **Step 2: Write the failing test**

Create `tests/adapters/rest.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { RestAdapter } from '../../src/adapters/communication/rest.js';
import path from 'node:path';

const GO_REST_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'go-rest-service'
);
const JAVA_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'java-service'
);

describe('RestAdapter', () => {
  const adapter = new RestAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('rest');
    expect(adapter.type).toBe('communication');
  });

  it('detects chi routes in a Go repo', async () => {
    const exposures = await adapter.findExposures!(GO_REST_REPO);
    const identifiers = exposures.map((e) => e.identifier).sort();
    expect(identifiers).toContain('GET /health');
    expect(identifiers).toContain('POST /orders');
    expect(identifiers).toContain('GET /orders/{id}');
    expect(identifiers).toContain('PUT /orders/{id}');
    expect(identifiers).toContain('DELETE /orders/{id}');
  });

  it('labels chi exposures with role=server and static confidence', async () => {
    const exposures = await adapter.findExposures!(GO_REST_REPO);
    for (const ex of exposures) {
      expect(ex.type).toBe('rest-endpoint');
      expect(ex.role).toBe('server');
      expect(ex.confidence).toBe('static');
      expect(ex.source.path.endsWith('router.go')).toBe(true);
      expect(typeof ex.source.line).toBe('number');
    }
  });

  it('detect() returns detected=true when any route is found', async () => {
    const result = await adapter.detect(GO_REST_REPO);
    expect(result.detected).toBe(true);
  });

  it('returns no exposures for a Java repo (Spring support deferred)', async () => {
    const exposures = await adapter.findExposures!(JAVA_REPO);
    expect(exposures).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/rest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the REST adapter**

Create `src/adapters/communication/rest.ts`:
```typescript
import { readFileSync } from 'node:fs';
import glob from 'fast-glob';
import path from 'node:path';
import type {
  CodeWikiAdapter,
  CommunicationDetection,
  Exposure,
} from '../types.js';

const CHI_METHOD_CALL =
  /\br\.(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]+)"/g;

export class RestAdapter implements CodeWikiAdapter {
  name = 'rest' as const;
  type = 'communication' as const;
  filePatterns = ['**/*.go'];

  async detect(repoPath: string): Promise<CommunicationDetection> {
    const exposures = await this.findExposures(repoPath);
    if (exposures.length === 0) {
      return {
        detected: false,
        details: {
          type: 'rest',
          role: 'server',
          identifiers: [],
          config_files: [],
        },
      };
    }
    return {
      detected: true,
      details: {
        type: 'rest',
        role: 'server',
        identifiers: exposures.map((e) => e.identifier),
        config_files: [...new Set(exposures.map((e) => e.source.path))],
      },
    };
  }

  async findExposures(repoPath: string): Promise<Exposure[]> {
    const goFiles = await glob(['**/*.go'], {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/vendor/**', '**/testdata/**', '**/*_test.go'],
    });

    const exposures: Exposure[] = [];
    for (const file of goFiles) {
      exposures.push(...this.scanGoChiFile(file, repoPath));
    }
    return exposures;
  }

  private scanGoChiFile(
    absPath: string,
    repoRoot: string
  ): Exposure[] {
    const rel = path.relative(repoRoot, absPath);
    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');
    const found: Exposure[] = [];

    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(CHI_METHOD_CALL)) {
        const method = m[1].toUpperCase();
        const routePath = m[2];
        found.push({
          type: 'rest-endpoint',
          identifier: `${method} ${routePath}`,
          role: 'server',
          source: { path: rel, line: i + 1 },
          detection_method: 'static',
          confidence: 'static',
        });
      }
    }
    return found;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/rest.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/communication/rest.ts tests/adapters/rest.test.ts tests/fixtures/repos/go-rest-service/
git commit -m "feat: REST adapter detects Go chi routes with line-level evidence"
```

---

## Task 6: Register REST adapter in builtins

**Files:**
- Modify: `src/adapters/registry.ts`
- Modify: `tests/adapters/registry.test.ts`

- [ ] **Step 1: Update registry test**

Open `tests/adapters/registry.test.ts` and replace the `loads built-in adapters` test (it's the last test in the file) with:

```typescript
  it('loads built-in adapters', () => {
    const registry = AdapterRegistry.withBuiltins();
    const languages = registry.getByType('language');
    expect(languages.length).toBeGreaterThanOrEqual(3); // java, typescript, go
    const comms = registry.getByType('communication');
    expect(comms.length).toBeGreaterThanOrEqual(2);     // kafka, rest
    expect(registry.getByName('rest')).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/registry.test.ts -t "loads built-in adapters"`
Expected: FAIL — only 1 communication adapter (kafka); no `rest` adapter registered.

- [ ] **Step 3: Register the REST adapter**

Open `src/adapters/registry.ts`. Add the import alongside the others:
```typescript
import { RestAdapter } from './communication/rest.js';
```

In the `withBuiltins()` method, register it right after `KafkaAdapter`:
```typescript
    registry.register(new KafkaAdapter());
    registry.register(new RestAdapter());
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/registry.ts tests/adapters/registry.test.ts
git commit -m "feat: register RestAdapter in AdapterRegistry.withBuiltins"
```

---

## Task 7: Scanner aggregates exposures into v2.0 fingerprint

**Files:**
- Modify: `src/scanner/fingerprint.ts`
- Modify: `tests/scanner/fingerprint.test.ts`

- [ ] **Step 1: Update scanner tests to assert v2.0 shape**

Replace the entire contents of `tests/scanner/fingerprint.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  fingerprintRepo,
} from '../../src/scanner/fingerprint.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import path from 'node:path';

const FIXTURES = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos'
);

describe('fingerprintRepo', () => {
  it('produces v2.0 schema with repo.name and repo.path', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(result.schema_version).toBe('2.0');
    expect(result.repo.name).toBe('java-service');
    expect(result.repo.path).toContain('java-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'java' })
    );
  });

  it('splits kafka-topic exposures by role into exposes/consumes', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'kafka-producer'),
      registry
    );
    const exposedTopics = result.exposes
      .filter((e) => e.type === 'kafka-topic')
      .map((e) => e.identifier);
    const consumedTopics = result.consumes
      .filter((e) => e.type === 'kafka-topic')
      .map((e) => e.identifier);

    // The kafka-producer fixture has both producer and consumer blocks,
    // so `both`-role topics appear in BOTH arrays.
    expect(exposedTopics).toContain('credit.check.requests');
    expect(consumedTopics).toContain('credit.check.requests');
  });

  it('puts REST endpoints into exposes for a Go chi service', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'go-rest-service'),
      registry
    );
    const restIds = result.exposes
      .filter((e) => e.type === 'rest-endpoint')
      .map((e) => e.identifier);
    expect(restIds).toContain('POST /orders');
    expect(restIds).toContain('GET /orders/{id}');
  });

  it('fingerprints a TypeScript service repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'ts-service'),
      registry
    );
    expect(result.repo.name).toBe('ts-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'typescript' })
    );
  });
});

describe('fingerprint (batch)', () => {
  it('scans multiple repos in a directory', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(FIXTURES, registry);
    const names = results.map((r) => r.repo.name);
    expect(names).toContain('java-service');
    expect(names).toContain('ts-service');
    expect(names).toContain('kafka-producer');
    expect(names).toContain('go-rest-service');
  });

  it('treats a single-repo path as one repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(results).toHaveLength(1);
    expect(results[0].repo.name).toBe('java-service');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/fingerprint.test.ts`
Expected: FAIL — the scanner still produces the v1 shape (`tech_stack.languages`, `communication`) and returns `repo_path` / `repo_name` at the top level instead of `repo.name` / `repo.path`.

- [ ] **Step 3: Rewrite the scanner**

Replace the contents of `src/scanner/fingerprint.ts` with:

```typescript
import path from 'node:path';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { LanguageDetection } from '../adapters/types.js';
import type { Exposure, RepoFingerprint } from '../fingerprint/types.js';
import { SCHEMA_VERSION } from '../fingerprint/schema.js';
import { discoverRepos } from './repo-walker.js';

export async function fingerprintRepo(
  repoPath: string,
  registry: AdapterRegistry
): Promise<RepoFingerprint> {
  const repoName = path.basename(repoPath);
  const languages: RepoFingerprint['tech_stack']['languages'] = [];
  const exposures: Exposure[] = [];

  for (const adapter of registry.getByType('language')) {
    const result = await adapter.detect(repoPath);
    if (result.detected) {
      const lang = result as LanguageDetection;
      languages.push({
        language: lang.details.language,
        version: lang.details.version,
        build_tool: lang.details.build_tool,
        dependencies: lang.details.dependencies,
      });
    }
  }

  for (const adapter of registry.getByType('communication')) {
    if (typeof adapter.findExposures === 'function') {
      const found = await adapter.findExposures(repoPath);
      exposures.push(...found);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    repo: { name: repoName, path: repoPath },
    scanned_at: new Date().toISOString(),
    tech_stack: { languages },
    exposes: exposures.filter((e) =>
      ['producer', 'server', 'both'].includes(e.role)
    ),
    consumes: exposures.filter((e) =>
      ['consumer', 'client', 'both'].includes(e.role)
    ),
  };
}

export async function fingerprint(
  parentDir: string,
  registry: AdapterRegistry
): Promise<RepoFingerprint[]> {
  const repoPaths = discoverRepos(parentDir);
  const results: RepoFingerprint[] = [];

  for (const repoPath of repoPaths) {
    const result = await fingerprintRepo(repoPath, registry);
    results.push(result);
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/fingerprint.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scanner/fingerprint.ts tests/scanner/fingerprint.test.ts
git commit -m "feat: scanner aggregates exposures into v2.0 fingerprint shape"
```

---

## Task 8: Graph builder matches exposes ↔ consumes via normalization

**Files:**
- Modify: `src/graph/types.ts`
- Modify: `src/graph/builder.ts`
- Modify: `tests/graph/builder.test.ts`

- [ ] **Step 1: Update graph tests to reflect v2.0 shape**

Replace the contents of `tests/graph/builder.test.ts` with:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/builder.test.ts`
Expected: FAIL — the builder still reads `fp.communication` (v1) and `fp.repo_name` (v1).

- [ ] **Step 3: Update ServiceNode type**

Open `src/graph/types.ts`. Replace `exposes: string[]` and `consumes: string[]` with the new typed shapes. At the top of the file, add the import for the `Exposure` type:

```typescript
import type { Exposure } from '../fingerprint/types.js';

export interface ServiceNode {
  id: string;
  repo: string;
  type: 'microservice' | 'library' | 'infrastructure' | 'frontend';
  tech_stack: {
    languages: string[];
    frameworks: string[];
    build: string[];
    runtime: string[];
    databases: string[];
  };
  exposes: Exposure[];
  consumes: Exposure[];
  last_scanned: string;
  scan_sha?: string;
}
```

Keep the existing `Edge` and `Graph` interfaces as-is.

- [ ] **Step 4: Rewrite graph/builder.ts**

Replace the contents of `src/graph/builder.ts` with:

```typescript
import type { RepoFingerprint, Exposure } from '../fingerprint/types.js';
import { normalizeIdentifier } from '../fingerprint/normalize.js';
import type { Graph, ServiceNode, Edge } from './types.js';

export function buildGraph(fingerprints: RepoFingerprint[]): Graph {
  const services = fingerprints.map(toServiceNode);
  const edges = buildEdges(fingerprints);
  return { schema_version: '2.0', services, edges };
}

function toServiceNode(fp: RepoFingerprint): ServiceNode {
  const languages = fp.tech_stack.languages.map((l) =>
    l.version ? `${l.language}:${l.version}` : l.language
  );

  const frameworks: string[] = [];
  const buildTools: string[] = [];

  for (const lang of fp.tech_stack.languages) {
    if (lang.build_tool) buildTools.push(lang.build_tool);
    for (const dep of lang.dependencies ?? []) {
      if (dep.scope === 'test' || dep.scope === 'dev') continue;
      if (dep.name.includes('spring-boot')) frameworks.push('spring-boot');
      if (dep.name === 'express') frameworks.push('express');
      if (dep.name === 'fastify') frameworks.push('fastify');
      if (dep.name === 'react') frameworks.push('react');
      if (dep.name === 'next') frameworks.push('next');
    }
  }

  return {
    id: fp.repo.name,
    repo: fp.repo.path,
    type: 'microservice',
    tech_stack: {
      languages: [...new Set(languages)],
      frameworks: [...new Set(frameworks)],
      build: [...new Set(buildTools)],
      runtime: [],
      databases: [],
    },
    exposes: fp.exposes,
    consumes: fp.consumes,
    last_scanned: fp.scanned_at,
    scan_sha: fp.repo.sha,
  };
}

interface Endpoint {
  service: string;
  exposure: Exposure;
}

function buildEdges(fingerprints: RepoFingerprint[]): Edge[] {
  const edges: Edge[] = [];
  let edgeId = 0;

  // (normalizedKey) → producers / consumers
  const producers = new Map<string, Endpoint[]>();
  const consumers = new Map<string, Endpoint[]>();

  for (const fp of fingerprints) {
    for (const ex of fp.exposes) {
      if (ex.identifier === '<unknown>') continue;
      const key = edgeKey(ex);
      const list = producers.get(key) ?? [];
      list.push({ service: fp.repo.name, exposure: ex });
      producers.set(key, list);
    }
    for (const ex of fp.consumes) {
      if (ex.identifier === '<unknown>') continue;
      const key = edgeKey(ex);
      const list = consumers.get(key) ?? [];
      list.push({ service: fp.repo.name, exposure: ex });
      consumers.set(key, list);
    }
  }

  for (const [key, prodList] of producers) {
    const consList = consumers.get(key) ?? [];
    for (const producer of prodList) {
      for (const consumer of consList) {
        if (producer.service === consumer.service) continue;
        edgeId++;
        edges.push({
          id: `e${String(edgeId).padStart(3, '0')}`,
          from: producer.service,
          to: consumer.service,
          type: edgeType(producer.exposure.type),
          bidirectional: false,
          details: detailsFor(producer.exposure),
          evidence: {
            from_file: producer.exposure.source.path,
            from_line: producer.exposure.source.line,
            to_file: consumer.exposure.source.path,
            to_line: consumer.exposure.source.line,
          },
          confidence:
            producer.exposure.confidence === 'static' &&
            consumer.exposure.confidence === 'static'
              ? 'static'
              : 'inferred',
          discovered_at: new Date().toISOString(),
          workflows: [],
        });
      }
    }
  }

  return edges;
}

function edgeKey(ex: Exposure): string {
  return `${ex.type}::${normalizeIdentifier(ex.type, ex.identifier)}`;
}

function edgeType(exposureType: Exposure['type']): string {
  if (exposureType === 'kafka-topic') return 'kafka';
  if (exposureType === 'rest-endpoint') return 'rest';
  if (exposureType === 'grpc-service') return 'grpc';
  return exposureType;
}

function detailsFor(ex: Exposure): Record<string, unknown> {
  if (ex.type === 'kafka-topic') return { topic: ex.identifier };
  if (ex.type === 'rest-endpoint') return { endpoint: ex.identifier };
  return { identifier: ex.identifier };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/graph/builder.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/types.ts src/graph/builder.ts tests/graph/builder.test.ts
git commit -m "feat: graph builder matches exposes/consumes via normalized identifiers"
```

---

## Task 9: Graph writer bumps schema_version to 2.0

**Files:**
- Modify: `src/graph/writer.ts`
- Modify: `tests/graph/writer.test.ts`

- [ ] **Step 1: Update writer tests for v2.0**

Replace the contents of `tests/graph/writer.test.ts` with:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/writer.test.ts`
Expected: FAIL if the writer hardcodes `'1.0'` anywhere; otherwise may already pass.

- [ ] **Step 3: Ensure writer passes the schema_version through**

Open `src/graph/writer.ts`. Search for any occurrence of the literal `'1.0'`. Each occurrence must be replaced with `graph.schema_version`. After the edit there should be zero `'1.0'` literals in the file.

If no `'1.0'` literal appears, tests likely already pass — proceed to Step 4 and skip directly to Step 5 if they do.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/writer.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/writer.ts tests/graph/writer.test.ts
git commit -m "feat: graph writer emits schema_version 2.0"
```

---

## Task 10: End-to-end CLI verification + release v0.2.0

**Files:**
- Modify: `package.json`
- Modify: `bin/code-wiki.ts` (scan summary output)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS. The count should be at least 50 (was 44 before 2a).

- [ ] **Step 2: Smoke test the CLI end-to-end**

Run:
```bash
rm -rf /tmp/code-wiki-2a-check
npx tsx bin/code-wiki.ts build --path tests/fixtures/repos --output /tmp/code-wiki-2a-check
```

Expected output includes:
```
Found 4 repos. Building graph...
Graph: 4 services, <N> edges
Writing graph to: /tmp/code-wiki-2a-check/graph/
Generating wiki to: /tmp/code-wiki-2a-check/
Build complete!
```

Then inspect the output:
```bash
head -30 /tmp/code-wiki-2a-check/graph/services.json
```

Verify:
- `"schema_version": "2.0"` at the top of `services.json`.
- At least one service with a non-empty `exposes` array containing a rest-endpoint (from `go-rest-service`).
- At least one service with non-empty exposes containing a kafka-topic (from `kafka-producer`).

- [ ] **Step 3: Update CLI scan summary to show exposure counts**

Open `bin/code-wiki.ts`. In the `scan` command's action handler, find the inner service-printing loop. It currently uses the v1 fields (`fp.communication`, `fp.repo_name`). Replace the body of the loop with:

```typescript
        const langs = fp.tech_stack.languages
          .map((l) => l.language)
          .join(', ');
        const exposeTypes = [
          ...new Set(fp.exposes.map((e) => e.type)),
        ].join(', ');
        const consumeTypes = [
          ...new Set(fp.consumes.map((e) => e.type)),
        ].join(', ');
        console.log(`  ${fp.repo.name}`);
        console.log(
          `    Languages: ${langs || 'none detected'}`
        );
        console.log(
          `    Exposes:   ${exposeTypes || 'none'} (${fp.exposes.length} entries)`
        );
        console.log(
          `    Consumes:  ${consumeTypes || 'none'} (${fp.consumes.length} entries)`
        );
```

- [ ] **Step 4: Re-run scan to confirm new output**

Run: `npx tsx bin/code-wiki.ts scan --path tests/fixtures/repos`

Expected output includes (in some order):
```
  go-rest-service
    Languages: go
    Exposes:   rest-endpoint (5 entries)
    Consumes:  none (0 entries)
  kafka-producer
    Languages: java
    Exposes:   kafka-topic (N entries)
    Consumes:  kafka-topic (N entries)
```

- [ ] **Step 5: Bump version**

Open `package.json` and change:
```json
"version": "0.1.0"
```
to:
```json
"version": "0.2.0"
```

- [ ] **Step 6: Commit + tag**

```bash
git add package.json bin/code-wiki.ts
git commit -m "chore: release v0.2.0 — fingerprint v2.0 schema + REST adapter"
git tag v0.2.0
```

- [ ] **Step 7: Clean up**

```bash
rm -rf /tmp/code-wiki-2a-check
```

---

## Summary

| Task | Component | Tests | Commits |
|------|-----------|-------|---------|
| 1 | Fingerprint v2.0 schema types | 4 | 1 |
| 2 | Identifier normalization | 9 | 1 |
| 3 | Adapter interface extension | - | 1 |
| 4 | Kafka adapter emits exposures | 7 | 1 |
| 5 | REST adapter (chi) + fixture | 4 | 1 |
| 6 | Register REST adapter | 1 (updated) | 1 |
| 7 | Scanner v2.0 output | 5 | 1 |
| 8 | Graph builder matches exposes/consumes | 6 | 1 |
| 9 | Graph writer v2.0 | 3 | 1 |
| 10 | CLI polish + release | - | 2 |

**Total:** ~39 new/updated assertions, 11 commits, one release tag (`v0.2.0`).

## What slice 2a does NOT ship (deferred to later slices)

- Express/Spring REST detection — chi only in 2a; other frameworks land in a later slice.
- Writing per-repo `fingerprint.json` to disk (federation depends on this) — slice 2d.
- Narration markers in wiki output — slice 2b.
- MCP server — slice 2c.
- Skills generation — slice 2e.

Each of these is a separate plan.
