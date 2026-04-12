# Phase 2b — Generator Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the per-repo wiki generator with four new pages (`api.md`, `runbook.md`, `glossary.md`, `workflows.md`) and introduce narration markers on pages that will later receive LLM-written prose. No version bump — slice 2b ships alongside slice 2c under `v0.3.0`.

**Architecture:** The current wiki generator at `src/wiki/templates.ts` owns all markdown templates and `src/wiki/generator.ts` orchestrates writing them to disk. Slice 2b adds four pure template functions (one per new page), wires them into the generator, and adds a small helper that emits narration markers. Narration markers are present but empty in v0.3.0 — the actual narration pass lands in slice 2f.

**Tech Stack:** TypeScript 5.x, Node.js 22+, Vitest. No new dependencies.

---

## File Structure

```
code-wiki/
├── src/wiki/
│   ├── narration.ts                   # NEW — marker helpers
│   ├── templates.ts                   # MODIFY — add 4 template functions + overview markers
│   └── generator.ts                   # MODIFY — write 4 new pages per service
├── tests/wiki/
│   ├── narration.test.ts              # NEW
│   └── generator.test.ts              # MODIFY — assertions for new pages
```

### Design constraints

- **Narration markers** are HTML comments that wrap a region of markdown. When narration is off, the region between markers is a placeholder line. When it's on (future slice), a narration pass rewrites only the region between the markers. Structural content outside the markers is never touched.
- Shape:
  ```
  <!-- narrated:start narrated_at="" narrated_model="" -->
  _No narration yet. Run `code-wiki narrate --page services/<id>/overview.md` to generate prose._
  <!-- narrated:end -->
  ```
  Empty `narrated_at` / `narrated_model` attributes signal "never narrated yet".
- New pages (`api.md`, `glossary.md`, `workflows.md`, `runbook.md`) are generated from `ServiceNode` data — specifically `service.exposes` and `service.consumes`, which are `Exposure[]` after slice 2a.
- `runbook.md` is scaffold-only — placeholder sections humans fill in, no auto-generated content beyond a frontmatter + section list. Never narrated.
- `workflows.md` in slice 2b shows only workflows that this repo declares (future slice 2d adds cross-repo workflows). Since the current graph has no `workflows_declared`, the page may be empty for most services — emit a "No workflows declared" placeholder when empty.

---

## Task 1: Narration marker helpers

**Files:**
- Create: `src/wiki/narration.ts`
- Create: `tests/wiki/narration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/wiki/narration.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  emptyNarrationBlock,
  findNarrationRegion,
} from '../../src/wiki/narration.js';

describe('emptyNarrationBlock', () => {
  it('emits start + placeholder + end markers', () => {
    const block = emptyNarrationBlock('services/svc-a/overview.md');
    expect(block).toContain('<!-- narrated:start');
    expect(block).toContain('narrated_at=""');
    expect(block).toContain('narrated_model=""');
    expect(block).toContain('<!-- narrated:end -->');
    expect(block).toContain('No narration yet');
    expect(block).toContain('services/svc-a/overview.md');
  });

  it('markers are on their own lines', () => {
    const block = emptyNarrationBlock('x.md');
    const lines = block.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('narrated:start'));
    const endIdx = lines.findIndex((l) => l.includes('narrated:end'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    // Start and end lines contain ONLY the marker comments
    expect(lines[startIdx].trim().startsWith('<!--')).toBe(true);
    expect(lines[startIdx].trim().endsWith('-->')).toBe(true);
    expect(lines[endIdx].trim()).toBe('<!-- narrated:end -->');
  });
});

describe('findNarrationRegion', () => {
  it('returns byte offsets for an existing narration region', () => {
    const md = [
      '# Title',
      '',
      '<!-- narrated:start narrated_at="2026-01-01" narrated_model="x" -->',
      'prose here',
      '<!-- narrated:end -->',
      '',
      '## Structural',
    ].join('\n');

    const region = findNarrationRegion(md);
    expect(region).not.toBeNull();
    expect(region!.innerStart).toBeGreaterThan(0);
    expect(region!.innerEnd).toBeGreaterThan(region!.innerStart);
    expect(md.slice(region!.innerStart, region!.innerEnd).trim()).toBe(
      'prose here'
    );
  });

  it('returns null when no markers are present', () => {
    expect(findNarrationRegion('# Title\n\nNo markers here.')).toBeNull();
  });

  it('returns null when only start marker is present', () => {
    const md = '# T\n<!-- narrated:start -->\nprose\n';
    expect(findNarrationRegion(md)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/wiki/narration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement narration helpers**

Create `src/wiki/narration.ts`:
```typescript
export interface NarrationRegion {
  /** Byte offset of the character immediately after the start marker's newline. */
  innerStart: number;
  /** Byte offset of the character immediately before the end marker. */
  innerEnd: number;
}

const START_MARKER_RE =
  /<!--\s*narrated:start[^>]*-->[^\n]*\n/;
const END_MARKER_RE =
  /\n\s*<!--\s*narrated:end\s*-->/;

/**
 * Emit a marker block with an empty narration region. Used when generating
 * pages before the narration pass has ever run. The `pagePath` hint lets
 * humans / tooling know which page to target when narrating.
 */
export function emptyNarrationBlock(pagePath: string): string {
  return [
    '<!-- narrated:start narrated_at="" narrated_model="" -->',
    `_No narration yet. Run \`code-wiki narrate --page ${pagePath}\` to generate prose._`,
    '<!-- narrated:end -->',
  ].join('\n');
}

/**
 * Find the offsets of the narration region inside a markdown document.
 * Returns null when the page has no narration markers or only one of them.
 */
export function findNarrationRegion(
  markdown: string
): NarrationRegion | null {
  const startMatch = markdown.match(START_MARKER_RE);
  if (!startMatch || startMatch.index === undefined) return null;

  const afterStart = startMatch.index + startMatch[0].length;
  const remainder = markdown.slice(afterStart);
  const endMatch = remainder.match(END_MARKER_RE);
  if (!endMatch || endMatch.index === undefined) return null;

  return {
    innerStart: afterStart,
    innerEnd: afterStart + endMatch.index,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/narration.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki/narration.ts tests/wiki/narration.test.ts
git commit -m "feat: narration marker helpers (empty block + region finder)"
```

---

## Task 2: api.md template — exposed endpoints and topics

**Files:**
- Modify: `src/wiki/templates.ts` (add `serviceApi` function)

- [ ] **Step 1: Add the failing generator-test for api.md**

Open `tests/wiki/generator.test.ts`. Find the existing `testGraph` constant. Confirm it has services with `exposes` entries (it should, from slice 2a). Then add this new test inside the existing `describe('generateWiki', ...)` block, just after the other page tests:

```typescript
  it('creates api.md listing exposed endpoints/topics', () => {
    generateWiki(testGraph, tmpDir);
    const apiPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'api.md'
    );
    expect(existsSync(apiPath)).toBe(true);
    const content = readFileSync(apiPath, 'utf-8');
    expect(content).toContain('generated_by: code-wiki');
    expect(content).toContain('# credit-gateway — API');
    // The testGraph should include at least one exposed entry for credit-gateway
    expect(content).toMatch(/kafka-topic|rest-endpoint/);
  });
```

If the existing `testGraph` has no exposes for `credit-gateway`, update it in the same file to add one Exposure to `credit-gateway`. Minimal change — add:
```typescript
exposes: [
  {
    type: 'kafka-topic',
    identifier: 'credit.check.requests',
    role: 'producer',
    source: { path: 'app.yaml', line: 5 },
    detection_method: 'static',
    confidence: 'static',
  },
],
consumes: [],
```
to the `credit-gateway` ServiceNode literal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wiki/generator.test.ts -t "api.md"`
Expected: FAIL — `api.md` not generated.

- [ ] **Step 3: Add the `serviceApi` template function**

Open `src/wiki/templates.ts`. Add this function at the bottom of the file (before the final closing — templates.ts has no top-level wrapping, just exported functions):

```typescript
export function serviceApi(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — API\n\n`;
  md +=
    '> Auto-generated from static analysis. Lists endpoints and topics this service exposes.\n\n';

  const byType = new Map<string, typeof service.exposes>();
  for (const ex of service.exposes) {
    const list = byType.get(ex.type) ?? [];
    list.push(ex);
    byType.set(ex.type, list);
  }

  if (byType.size === 0) {
    md += 'No exposed endpoints or topics detected.\n';
    return md;
  }

  for (const [type, entries] of byType) {
    md += `## ${prettyTypeName(type)} (${entries.length})\n\n`;
    md += '| Identifier | Role | Source | Confidence |\n';
    md += '|------------|------|--------|------------|\n';
    for (const ex of entries) {
      const src = ex.source.line
        ? `${ex.source.path}:${ex.source.line}`
        : ex.source.path;
      md += `| \`${ex.identifier}\` | ${ex.role} | ${src} | ${ex.confidence} |\n`;
    }
    md += '\n';
  }

  return md;
}

function prettyTypeName(type: string): string {
  if (type === 'kafka-topic') return 'Kafka Topics';
  if (type === 'rest-endpoint') return 'REST Endpoints';
  if (type === 'grpc-service') return 'gRPC Services';
  if (type === 'db-schema') return 'Database Schemas';
  return type;
}
```

- [ ] **Step 4: Wire it into the generator**

Open `src/wiki/generator.ts`. Add `serviceApi` to the import list from `./templates.js`:

```typescript
import {
  wikiIndex,
  serviceOverview,
  serviceTechStack,
  serviceDependencies,
  serviceApi,
} from './templates.js';
```

Inside the `for (const service of graph.services)` loop, add a write for `api.md` right after the existing dependencies.md write:

```typescript
    writeFileSync(
      path.join(serviceDir, 'api.md'),
      serviceApi(service),
      'utf-8'
    );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/generator.test.ts`
Expected: All tests PASS, including the new `api.md` test.

- [ ] **Step 6: Commit**

```bash
git add src/wiki/templates.ts src/wiki/generator.ts tests/wiki/generator.test.ts
git commit -m "feat: generate api.md per service listing exposed endpoints/topics"
```

---

## Task 3: glossary.md template — identifier reference

**Files:**
- Modify: `src/wiki/templates.ts` (add `serviceGlossary`)
- Modify: `src/wiki/generator.ts`
- Modify: `tests/wiki/generator.test.ts`

- [ ] **Step 1: Add the failing test**

Inside the `describe('generateWiki')` block in `tests/wiki/generator.test.ts`, add:

```typescript
  it('creates glossary.md listing every identifier the service touches', () => {
    generateWiki(testGraph, tmpDir);
    const glossaryPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'glossary.md'
    );
    expect(existsSync(glossaryPath)).toBe(true);
    const content = readFileSync(glossaryPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Glossary');
    expect(content).toContain('generated_by: code-wiki');
    // Has at least an identifier from exposes OR consumes
    expect(content).toMatch(/`[a-zA-Z0-9._\/-]+`/);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/wiki/generator.test.ts -t "glossary"`
Expected: FAIL — `glossary.md` not generated.

- [ ] **Step 3: Add the `serviceGlossary` template**

In `src/wiki/templates.ts`, append:

```typescript
export function serviceGlossary(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Glossary\n\n`;
  md +=
    '> Every identifier this service exposes or consumes, with direction.\n\n';

  const all = [
    ...service.exposes.map((e) => ({ ex: e, direction: 'exposes' as const })),
    ...service.consumes.map((e) => ({ ex: e, direction: 'consumes' as const })),
  ];

  if (all.length === 0) {
    md += 'No identifiers detected for this service.\n';
    return md;
  }

  // Dedupe on (direction, type, identifier)
  const seen = new Set<string>();
  const unique = all.filter(({ ex, direction }) => {
    const key = `${direction}::${ex.type}::${ex.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Group by direction
  const exposes = unique.filter((u) => u.direction === 'exposes');
  const consumes = unique.filter((u) => u.direction === 'consumes');

  const section = (
    title: string,
    rows: typeof unique
  ): string => {
    if (rows.length === 0) return '';
    let out = `## ${title} (${rows.length})\n\n`;
    out += '| Identifier | Type | Source |\n';
    out += '|------------|------|--------|\n';
    for (const { ex } of rows) {
      const src = ex.source.line
        ? `${ex.source.path}:${ex.source.line}`
        : ex.source.path;
      out += `| \`${ex.identifier}\` | ${ex.type} | ${src} |\n`;
    }
    out += '\n';
    return out;
  };

  md += section('Exposes', exposes);
  md += section('Consumes', consumes);
  return md;
}
```

- [ ] **Step 4: Wire into generator**

In `src/wiki/generator.ts`, add `serviceGlossary` to the imports and add a write inside the per-service loop:

```typescript
    writeFileSync(
      path.join(serviceDir, 'glossary.md'),
      serviceGlossary(service),
      'utf-8'
    );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/generator.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wiki/templates.ts src/wiki/generator.ts tests/wiki/generator.test.ts
git commit -m "feat: generate glossary.md per service from exposes/consumes"
```

---

## Task 4: runbook.md scaffold

**Files:**
- Modify: `src/wiki/templates.ts` (add `serviceRunbook`)
- Modify: `src/wiki/generator.ts`
- Modify: `tests/wiki/generator.test.ts`

- [ ] **Step 1: Add the failing test**

Inside the `describe('generateWiki')` block:

```typescript
  it('creates runbook.md scaffold with placeholder sections', () => {
    generateWiki(testGraph, tmpDir);
    const runbookPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'runbook.md'
    );
    expect(existsSync(runbookPath)).toBe(true);
    const content = readFileSync(runbookPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Runbook');
    expect(content).toContain('generated_by: code-wiki');
    expect(content).toContain('## On-call');
    expect(content).toContain('## Dashboards');
    expect(content).toContain('## Common incidents');
    // Must clearly signal that humans own this file's content
    expect(content.toLowerCase()).toContain('fill in');
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/wiki/generator.test.ts -t "runbook"`
Expected: FAIL.

- [ ] **Step 3: Add the `serviceRunbook` template**

In `src/wiki/templates.ts`, append:

```typescript
export function serviceRunbook(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
    note: 'scaffold — humans own the content of this file',
  });

  let md = `${fm}# ${service.id} — Runbook\n\n`;
  md +=
    '> **Scaffold only.** Fill in the sections below with ops knowledge. code-wiki will not overwrite content, only regenerate the frontmatter header.\n\n';

  md += '## On-call\n\n';
  md += '- _Fill in: who owns this service, escalation path, Slack channel._\n\n';

  md += '## Dashboards\n\n';
  md += '- _Fill in: links to relevant Grafana / Datadog / Kibana dashboards._\n\n';

  md += '## Common incidents\n\n';
  md += '- _Fill in: known failure modes, symptoms, mitigations._\n\n';

  md += '## Deployment\n\n';
  md += '- _Fill in: how to deploy, roll back, and verify._\n\n';

  md += '## Dependencies to watch\n\n';
  md += '- _Fill in: upstream services, infrastructure, third parties._\n';

  return md;
}
```

**Important:** the scaffold writer must NOT overwrite a human-edited runbook. Handle that in generator.ts next.

- [ ] **Step 4: Wire into generator with scaffold-preserving behavior**

Open `src/wiki/generator.ts`. Add `serviceRunbook` to the imports, then add this block inside the per-service loop (distinct from the other writes — don't overwrite):

```typescript
    const runbookPath = path.join(serviceDir, 'runbook.md');
    if (!existsSync(runbookPath)) {
      writeFileSync(runbookPath, serviceRunbook(service), 'utf-8');
    }
```

Also add `existsSync` to the `node:fs` import at the top of the file:

```typescript
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 5: Add a test for the preservation behavior**

Add a second runbook test inside the same describe block:

```typescript
  it('does not overwrite an existing runbook.md', () => {
    generateWiki(testGraph, tmpDir);
    const runbookPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'runbook.md'
    );
    const customContent = '# my custom runbook\n\nownership: team-foo\n';
    writeFileSync(runbookPath, customContent, 'utf-8');

    // Regenerate
    generateWiki(testGraph, tmpDir);

    expect(readFileSync(runbookPath, 'utf-8')).toBe(customContent);
  });
```

Note: this test needs `writeFileSync` imported in the test file. Add it to the existing `import from 'node:fs'` line if not already there.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/generator.test.ts`
Expected: All tests PASS (including both runbook tests).

- [ ] **Step 7: Commit**

```bash
git add src/wiki/templates.ts src/wiki/generator.ts tests/wiki/generator.test.ts
git commit -m "feat: runbook.md scaffold; never overwritten once created"
```

---

## Task 5: workflows.md placeholder

**Files:**
- Modify: `src/wiki/templates.ts` (add `serviceWorkflows`)
- Modify: `src/wiki/generator.ts`
- Modify: `tests/wiki/generator.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
  it('creates workflows.md (placeholder when no workflows declared)', () => {
    generateWiki(testGraph, tmpDir);
    const workflowsPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'workflows.md'
    );
    expect(existsSync(workflowsPath)).toBe(true);
    const content = readFileSync(workflowsPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Workflows');
    expect(content).toContain('generated_by: code-wiki');
    // Slice 2d will add real workflow content; for now: placeholder
    expect(content.toLowerCase()).toMatch(
      /no workflows|federation not enabled/
    );
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/wiki/generator.test.ts -t "workflows"`
Expected: FAIL.

- [ ] **Step 3: Add the `serviceWorkflows` template**

In `src/wiki/templates.ts`, append:

```typescript
export function serviceWorkflows(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Workflows\n\n`;
  md +=
    '> Named workflows this service participates in. Cross-repo workflows require federation to be enabled.\n\n';
  md +=
    'No workflows declared locally and federation not enabled. ' +
    'Declare workflows in `code-wiki.yaml` or enable federation to see cross-repo flows.\n';
  return md;
}
```

Note: in slice 2b we emit the same placeholder for every service. Slice 2d will wire real workflow data here once the org graph is available.

- [ ] **Step 4: Wire into generator**

In `src/wiki/generator.ts`, add `serviceWorkflows` to the imports and add a write inside the per-service loop:

```typescript
    writeFileSync(
      path.join(serviceDir, 'workflows.md'),
      serviceWorkflows(service),
      'utf-8'
    );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/generator.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wiki/templates.ts src/wiki/generator.ts tests/wiki/generator.test.ts
git commit -m "feat: workflows.md placeholder per service (real content in slice 2d)"
```

---

## Task 6: Narration markers on overview.md

**Files:**
- Modify: `src/wiki/templates.ts` (update `serviceOverview` to include markers)
- Modify: `tests/wiki/generator.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
  it('overview.md includes empty narration markers', () => {
    generateWiki(testGraph, tmpDir);
    const overviewPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'overview.md'
    );
    const content = readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('<!-- narrated:start');
    expect(content).toContain('<!-- narrated:end -->');
    expect(content).toContain('narrated_at=""');
    // Structural content still present
    expect(content).toContain('## Tech Stack');
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/wiki/generator.test.ts -t "narration markers"`
Expected: FAIL — current overview has no markers.

- [ ] **Step 3: Update `serviceOverview` to include markers**

Open `src/wiki/templates.ts`. Add an import at the top:

```typescript
import { emptyNarrationBlock } from './narration.js';
```

Locate `serviceOverview`. Find the line right after the `> Auto-generated from structural analysis...` quote block. Insert the narration marker block there, BEFORE the `## Tech Stack` section. The updated sequence should read:

```typescript
  let md = `${fm}# ${service.id}\n\n`;
  md +=
    '> Auto-generated from structural analysis. Run `code-wiki narrate` to add prose.\n\n';
  md += `${emptyNarrationBlock(`services/${service.id}/overview.md`)}\n\n`;
  md += '## Tech Stack\n\n';
  // ... rest unchanged
```

Also update the descriptive line to point at `code-wiki narrate` (replacing the old `code-wiki build` reference) as shown.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/wiki/generator.test.ts`
Expected: All tests PASS including the new narration-markers test.

- [ ] **Step 5: Commit**

```bash
git add src/wiki/templates.ts tests/wiki/generator.test.ts
git commit -m "feat: overview.md includes empty narration markers (off by default)"
```

---

## Task 7: End-to-end smoke + summary

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS. Count should be ≥ 80 (was 70 after slice 2a).

- [ ] **Step 2: Smoke test the full CLI**

```bash
rm -rf /tmp/code-wiki-2b-check
npx tsx bin/code-wiki.ts build --path tests/fixtures/repos --output /tmp/code-wiki-2b-check
```

Verify the new pages exist for a representative service:
```bash
ls /tmp/code-wiki-2b-check/services/kafka-producer/
```

Expected output includes: `api.md`, `dependencies.md`, `glossary.md`, `overview.md`, `runbook.md`, `tech-stack.md`, `workflows.md`.

- [ ] **Step 3: Spot-check the rendered content**

```bash
head -30 /tmp/code-wiki-2b-check/services/kafka-producer/api.md
```

Expected:
- Frontmatter block with `generated_by: code-wiki`
- `# kafka-producer — API` heading
- A section like `## Kafka Topics (N)` with a table of identifiers

```bash
head -30 /tmp/code-wiki-2b-check/services/kafka-producer/overview.md
```

Expected: frontmatter, title, quote block, then `<!-- narrated:start ... -->` ... `<!-- narrated:end -->` block, then `## Tech Stack`.

```bash
head -30 /tmp/code-wiki-2b-check/services/go-rest-service/api.md
```

Expected: a `## REST Endpoints (5)` section listing `GET /health`, `POST /orders`, etc. with source file:line.

- [ ] **Step 4: Clean up**

```bash
rm -rf /tmp/code-wiki-2b-check
```

- [ ] **Step 5: No version bump in this slice**

Per the Phase 2 spec's release plan, `v0.3.0` is cut after slice 2c ships. Do NOT bump `package.json`, do NOT tag anything.

Final commit (no changes, just verifying the checkpoint):

```bash
git log --oneline -8
```

Expected: see the 6 commits from tasks 1–6, plus the earlier slice 2a history.

---

## Summary

| Task | Component | Tests | Commits |
|------|-----------|-------|---------|
| 1 | Narration marker helpers | 5 | 1 |
| 2 | api.md template + wire-up | 1 | 1 |
| 3 | glossary.md template + wire-up | 1 | 1 |
| 4 | runbook.md scaffold (preserving) | 2 | 1 |
| 5 | workflows.md placeholder | 1 | 1 |
| 6 | Narration markers on overview.md | 1 | 1 |
| 7 | End-to-end verification | - | 0 |

**Total:** ~11 new tests, 6 commits, no release tag.

## What slice 2b does NOT ship

- LLM narration pass (the pass that fills in marker regions) — slice 2f.
- Real workflow rendering in `workflows.md` — slice 2d (federation required to know cross-repo workflow members).
- Org-wide wiki pages (`wiki/workflows/<name>.md`, `wiki/tech-matrix.md`) — slice 2d.
- MCP server — slice 2c.
- Config-driven generator toggles — slice 2f polish.
