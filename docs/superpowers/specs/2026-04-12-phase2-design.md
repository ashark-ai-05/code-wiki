# Phase 2 Design — Federation, MCP Server, and Auto-Generated Skills

**Status:** Approved design. Ready for implementation planning.
**Date:** 2026-04-12
**Supersedes / extends:** [`2026-04-12-code-wiki-design.md`](./2026-04-12-code-wiki-design.md) (Phase 1 MVP)
**Author:** krunal (with AI collaboration)

---

## Goal

Turn code-wiki from a local CLI that produces static wiki pages into a platform that:

1. **Answers natural-language queries about any codebase** via an MCP server consumed by agents (Claude Code, amp, opencode, copilot-cli).
2. **Self-documents** — automatically keeps wiki pages, architecture diagrams, and tech-stack catalogs current.
3. **Keeps Claude Code skills current as code changes** — per-workflow skills regenerate on every scan.
4. **Queries upstream/downstream repos** — a git-native federation model builds an org-wide graph from per-repo fingerprints.

All four goals must work on a single repo AND scale to hundreds of repos across an org. Single-repo mode is the default; federation is additive and opt-in.

## Non-goals (Phase 2 YAGNI list)

- Semantic / vector code search. Sourcegraph already does this; we compose with it, we do not duplicate it.
- Auto-generated agents. Deferred to Phase 3 — skills alone deliver the core value.
- HTTP / SSE MCP transport. stdio only.
- Non-git federation (S3, custom service). Deferred until an org outgrows git.
- Tree-sitter parsing or full symbol tables. The `exposes` / `consumes` schema is sufficient.
- Live watch mode / daemons. Scans run on commit, CI, or manual invocation.
- Authoring tools (editing the graph by hand). The graph is derived only.
- LLMs in the critical path. Narration is optional and opt-in.

## Context / motivation

Phase 1 shipped a CLI that scans a directory of repos, fingerprints their tech stacks, discovers Kafka-based edges, and writes a JSON graph + markdown wiki. That works for a single developer on one machine.

Phase 2 is triggered by real organizational needs: developers want to ask natural-language questions about architecture across dozens of repos, and they want Claude Code skills that stay in sync with the code without a human editing them. The platform needs to operate both standalone (open-source users, single repo) and federated (org users, many repos) without forcing users into one mode.

Crucially, **the LLM does not live inside code-wiki**. Org users consume code-wiki through an agent that already owns the LLM (amp, opencode, Claude Code, copilot-cli). Open-source users may configure their own LLM via the existing `llm` config section for optional narration. This avoids vendor lock-in and keeps the core tool deterministic.

---

## Architecture

### Three processes, one data model

```
┌──────────────┐   writes    ┌─────────────────────┐   reads     ┌──────────────┐
│  Scanner     │────────────→│  Artifact Store     │────────────→│  MCP Server  │
│ (per repo)   │             │  (git-native)       │             │  (local)     │
└──────────────┘             └─────────────────────┘             └──────────────┘
      ▲                                                                  ▲
      │ on git push /                                                    │ stdio MCP
      │ CI merge                                                         │
 ┌────┴────┐                                                    ┌────────┴────────┐
 │  Repo   │                                                    │ amp / opencode /│
 │         │                                                    │ copilot / Claude│
 └─────────┘                                                    └─────────────────┘
```

Each process has one responsibility:

- **Scanner** produces per-repo `fingerprint.json` and generated artifacts (wiki pages, skill files). Runs on commit, in CI, or manually via `code-wiki build`.
- **Artifact store** is a dedicated git repo (`org-code-wiki`) holding all fingerprints + merged org graph. Serves as the federation backbone.
- **MCP server** is a stateless binary (`code-wiki mcp`) that reads the graph (local or federated) and serves queries to agents over stdio.

The scanner writes, the MCP server reads, and the artifact store mediates between them. There is no shared runtime state — everything flows through files.

### How single-repo and multi-repo coexist

- **Single repo:** scanner runs locally, writes graph to `docs/wiki/graph/`. MCP server reads from there. No federation.
- **Org / multi-repo:** each repo publishes its fingerprint to the shared repo; a merge job rebuilds the org graph. MCP server pulls that repo and answers against the merged view.
- **Transition:** adding a `federation.url` to a repo's `code-wiki.yaml` flips it from single-repo to federated. No schema change, no data migration.

---

## Data model

### `fingerprint.json` (per repo, schema v2.0)

Each repo produces exactly one fingerprint file. It is the authoritative input to the federation merge job and to local MCP queries.

```jsonc
{
  "schema_version": "2.0",
  "repo": {
    "name": "visualhft-go",
    "remote": "git@bitbucket.org:org/visualhft-go.git",
    "branch": "main",
    "sha": "abc123…"
  },
  "scanned_at": "2026-04-12T10:00:00Z",
  "tech_stack": {
    "languages": [ { "language": "go", "version": "1.24.2", "build_tool": "go" } ],
    "frameworks": [ "chi", "gorilla/websocket" ],
    "build": [ "go" ]
  },
  "exposes": [
    {
      "type": "rest-endpoint",
      "identifier": "POST /orders",
      "role": "server",
      "source": { "path": "cmd/server/router.go", "line": 42 },
      "detection_method": "static",
      "confidence": "static"
    },
    {
      "type": "kafka-topic",
      "identifier": "orders.new",
      "role": "producer",
      "source": { "path": "internal/publisher/kafka.go", "line": 18 },
      "detection_method": "static",
      "confidence": "static"
    }
  ],
  "consumes": [
    {
      "type": "kafka-topic",
      "identifier": "orders.cancelled",
      "role": "consumer",
      "source": { "path": "internal/consumer/cancel.go", "line": 11 },
      "detection_method": "static",
      "confidence": "static"
    }
  ],
  "workflows_declared": [
    { "name": "order-placement", "entry_point": true }
  ]
}
```

**Key schema decisions:**
- `exposes` and `consumes` are top-level arrays (split from a generic "dependencies" list) so edge matching is deterministic.
- Each entry carries `identifier`, `role`, `source.{path,line}`, `detection_method` ("static" | "annotated" | "inferred"), and `confidence` ("static" | "inferred"). These fields flow through to MCP tool responses as evidence.
- `workflows_declared` is optional; a repo may declare itself the entry point of a named workflow, which the merge job uses when building workflow subgraphs.
- Identifiers are normalized at merge time (lowercase, trimmed, version-suffix stripped per configurable rules) so minor differences across repos do not break edge matching.

### Org graph (in the federation repo)

Built by the merge job from all fingerprints.

- `graph/services.json` — every service across the org.
- `graph/edges.json` — cross-repo edges derived by matching identifiers from one repo's `exposes` against another repo's `consumes`.
- `graph/workflows.json` — named workflows (declared in any `code-wiki.yaml` + auto-discovered by tracing from entry points).
- `graph/tech-matrix.json` — services grouped by language / framework / build tool.

### Per-repo generated artifacts

Committed into each repo, not the artifact store. `generated_by: code-wiki` frontmatter marks everything the tool owns.

```
your-repo/
├── docs/wiki/                     # human-readable docs
│   ├── index.md
│   ├── overview.md
│   ├── tech-stack.md
│   ├── dependencies.md
│   ├── workflows.md               # local view + links to org pages when federated
│   ├── api.md                     # exposed endpoints / topics
│   ├── runbook.md                 # scaffold only; humans fill in
│   └── graph/                     # local snapshot of fingerprint + graph
├── .claude/skills/                # Claude Code skills (one per participating workflow)
├── .claude/agents/                # (reserved for Phase 3 — not generated in Phase 2)
└── code-wiki.yaml                 # config, source of truth
```

### Org-wide generated artifacts

Committed into the federation repo by the merge job.

```
org-code-wiki/
├── fingerprints/                  # one file per service — authored by each repo's CI
│   ├── order-gateway.json
│   ├── risk-calc.json
│   └── ...
├── graph/                         # generated, protected from manual edits
│   ├── services.json
│   ├── edges.json
│   ├── workflows.json
│   └── tech-matrix.json
└── wiki/                          # cross-repo narratives
    ├── index.md
    ├── workflows/<name>.md
    └── tech-matrix.md
```

---

## MCP server

### Transport and invocation

- Single binary: `code-wiki mcp`.
- Transport: MCP over stdio. Every agent (Claude Code, amp, opencode, copilot-cli) supports this natively.
- No HTTP, no auth layer, no network surface.
- Stateless: reads graph fresh at startup and on explicit `refresh()`. No daemons.

Example agent configuration (Claude Code `.mcp.json`, equivalent in other agents):
```json
{
  "mcpServers": {
    "code-wiki": { "command": "code-wiki", "args": ["mcp"] }
  }
}
```

### Graph source discovery

Priority order:
1. `$CODE_WIKI_GRAPH` env variable (explicit override, primarily for CI).
2. `./docs/wiki/graph/` relative to CWD (single-repo local mode).
3. `~/.code-wiki/org/graph/` — a local clone of the federation repo, auto-pulled on startup if `federation.url` is set in `~/.code-wiki/config.yaml`.

One binary; mode determined by where it is launched and what config it finds.

### Tool catalog

All tools return a consistent envelope:

```jsonc
{
  "data": { /* tool-specific payload */ },
  "evidence": [
    { "kind": "file", "service_id": "credit-gateway", "path": "src/KafkaProducer.java", "line": 42 }
  ],
  "confidence": "static",
  "sources": {
    "graph_sha": "abc123",
    "fingerprint_shas": { "credit-gateway": "def456" }
  }
}
```

**Graph / relationship tools** (cheap, precise — answer most questions)

| Tool | Purpose |
|------|---------|
| `list_services(filter?)` | All services, optional filter by language/framework |
| `get_service(id)` | Full service object: tech stack, exposes, consumes, paths |
| `find_by_tech(category, value)` | "All Spring Boot services" / "All repos using Kafka" |
| `trace_downstream(service_id, depth?)` | Follow outgoing edges N levels |
| `trace_upstream(service_id, depth?)` | Follow incoming edges N levels |
| `get_edges(filter?)` | All edges matching type/from/to |
| `list_workflows()` | Declared + auto-discovered workflows |
| `get_workflow(name)` | Services + edges + subgraph for one workflow |

**Code-level tools** (resolve paths via `services.json[id].repo`)

| Tool | Purpose |
|------|---------|
| `list_files(service_id, glob?)` | List paths in a service's repo |
| `read_file(service_id, path, range?)` | File contents, optional line range |
| `search_files(service_id, regex, glob?)` | Grep within a service |

If a service's local path is absent, these tools return a clear error message telling the agent what to do (clone URL, or service is remote-only).

**Meta tools**

| Tool | Purpose |
|------|---------|
| `stats()` | Service/edge counts, last scan time, graph source |
| `refresh()` | Re-pull federation repo + reload graph |
| `health()` | Schema version, missing paths, stale fingerprints |

### Explicitly not included

- No `semantic_search` tool. Sourcegraph MCP covers this; composition is better than duplication.
- No LLM-calling tool. Agents own the LLM.
- No write tools (`create_service`, `add_edge`). The graph is derived.
- No mega-tool `ask_nl(query)`. That re-centralizes what the agent should own.

### Code-access strategy (Phase 2)

MCP server reads only from `services.json[id].repo` paths on the local machine. Developers keep repos cloned at known paths (the typical setup); CI can set `CODE_WIKI_REPO_ROOT` or equivalent. If a path is missing, the tool returns a structured error. **Clone-on-demand is Phase 3.**

---

## Generation layer

Three generators run after every scan. All are deterministic from the fingerprint + graph — except the narration pass, which is optional.

### Generator 1 — Wiki

Refreshes the existing MVP output and adds new pages.

**Per-repo** (written to `docs/wiki/`):
- `index.md` — local service landing page.
- `overview.md`, `tech-stack.md`, `dependencies.md` — refreshed from MVP.
- `workflows.md` — workflows this service participates in; links to org-wide workflow pages when federation is enabled.
- `api.md` — exposed endpoints and topics (from `exposes`).
- `runbook.md` — scaffold only (template placeholders); humans fill in.
- `glossary.md` — auto-populated from `exposes` / `consumes` identifiers and any declared terms in `code-wiki.yaml` (optional).

**Org-wide** (written to federation repo `wiki/`):
- `index.md` — service catalog + tech matrix.
- `workflows/<name>.md` — one page per named workflow with service chain + mermaid diagram.
- `tech-matrix.md` — who uses what.

**Optional LLM narration pass:**
- Runs only if `generators.narration.enabled: true` and `llm` config is populated.
- Cached on `(page-source-sha, llm-model, prompt-template-version)` — re-runs skipped when nothing changed.
- Narrated regions live between markers:
  ```
  <!-- narrated:start narrated_at="2026-04-12T10:00:00Z" narrated_model="claude-opus-4-6" -->
  …LLM-written prose…
  <!-- narrated:end -->
  ```
- Structural sections (tech-stack table, exposes list, mermaid diagram, etc.) are never touched by narration.

### Generator 2 — Skills

**One skill per named workflow**, plus one top-level `org-context` skill in every repo.

Each skill lives at `.claude/skills/<skill-name>/SKILL.md` in every repo that participates in that workflow. The frontmatter `description` is the match signal Claude uses to auto-activate the skill.

Example (auto-generated from `code-wiki.yaml`'s `order-placement` workflow):
```markdown
---
name: order-placement
description: Use when working on order placement, order routing, or order
  validation. Spans order-gateway (Java 17 / Spring Boot), order-router
  (Go 1.22 / chi), and price-check (Python 3.12 / FastAPI). Kafka topic
  orders.new flows producer → router → validator. Trigger on questions about
  order flow, order validation, price lookups, or any of the listed services.
generated_by: code-wiki
generated_at: 2026-04-12T10:00:00Z
---

# Order Placement Workflow

## Services involved
- **order-gateway** — entry point, REST `POST /orders`
- **order-router** — Kafka consumer of `orders.new`, publishes `orders.routed`
- **price-check** — consumes `orders.routed`, calls pricing-engine

## Current tech stack (auto-generated)
[table pulled from fingerprints]

## Key edges
[mermaid diagram]

## Where code lives
[file paths keyed by service]

## Related workflows
- [order-cancellation](../order-cancellation/SKILL.md)
- [settlement](../settlement/SKILL.md)

## For deeper queries
Use the code-wiki MCP tools: `get_workflow("order-placement")`, `trace_downstream("order-gateway")`.
```

Top-level `org-context` skill (written to every repo, including repos with zero workflows defined):
```markdown
---
name: org-context
description: Use when the user asks about org-wide architecture, cross-service
  workflows, or "which services do X". Loads the code-wiki graph via MCP.
generated_by: code-wiki
---
Directs Claude to use the code-wiki MCP server for ground-truth architecture data.
```

### Generator 3 — Agents (deferred to Phase 3)

Agents require domain-specific prompt engineering that does not generalize cleanly in Phase 2. The `.claude/agents/` directory is reserved and left empty by the scanner. Users may author custom agents there manually; the scanner does not touch files in that directory during Phase 2.

### Regeneration triggers

| Trigger | Where | Primary use |
|---------|-------|-------------|
| `code-wiki build` (manual) | Dev laptop | Ad-hoc, single-repo, open-source |
| CI on merge to main | Per-repo CI | Org default — keeps artifacts in sync |
| Federation merge job | `org-code-wiki` CI | Rebuilds org-wide wiki + aggregate artifacts after any fingerprint PR |

**Commit-loop prevention:** generated files commit with the message `chore(code-wiki): regenerate artifacts [skip ci]`. Changed files are only committed if they actually diff from what's on disk — most scans produce identical output and commit nothing.

**Custom skills / agents are never overwritten.** The generator only touches files whose frontmatter contains `generated_by: code-wiki`.

---

## CLI surface

Every command is a thin orchestrator over the engine.

| Command | Role | Runs where |
|---------|------|------------|
| `code-wiki init` | Interactive wizard; writes a validated `code-wiki.yaml` | Repo root |
| `code-wiki scan` | Produces `fingerprint.json` + structural wiki skeleton | Any repo |
| `code-wiki build` | `scan` + run all enabled generators | Any repo |
| `code-wiki publish` | Pushes fingerprint to federation repo | Repo or CI |
| `code-wiki pull` | Clones/updates federation repo to `~/.code-wiki/org/` | Dev laptop |
| `code-wiki merge` | Rebuilds org graph + org wiki from all fingerprints | Federation repo CI only |
| `code-wiki narrate` | Runs LLM narration pass (opt-in) | Repo or CI |
| `code-wiki mcp` | Starts MCP server over stdio | Spawned by agent |
| `code-wiki status` | Shows graph source, freshness, stale/missing fingerprints | Anywhere |

Global flags honored by every command: `--config <path>`, `--graph <path>`, `--dry-run`.

---

## Config extensions to `code-wiki.yaml`

Three new sections, all optional.

```yaml
federation:
  enabled: false
  provider: git                       # only option in Phase 2
  url: git@bitbucket.org:your-org/code-wiki-org.git
  branch: main
  publish_strategy: branch            # branch (opens PR) | direct (push main)
  auth:
    method: ssh                       # ssh | token
    env_var: CODE_WIKI_TOKEN          # when method: token

generators:
  wiki:
    enabled: true
    path: docs/wiki
    include_mermaid: true
  skills:
    enabled: true
    path: .claude/skills
    granularity: workflow             # workflow | service (future)
  agents:
    enabled: false                    # Phase 3
  narration:
    enabled: false                    # opt-in
    include_pages: [overview, workflows]
    exclude_pages: [tech-stack, dependencies]

mcp:
  transport: stdio                    # only option in Phase 2
  tools: all                          # all | [list of tool names]
  repo_paths:                         # optional — for code-level tools in org mode
    credit-gateway: ~/src/credit-gateway
    risk-calc:      ~/src/risk-calc
```

Existing sections (`version`, `sources`, `workflows`, `output`, `analysis`, `llm`) are unchanged. Phase 1 configs remain valid.

---

## Federation flow (git-native)

### Setup, once per org
1. Create `code-wiki-org` repo (empty).
2. Add a CI workflow in `code-wiki-org/.github/workflows/merge.yml` (or equivalent Bitbucket pipeline) that runs `code-wiki merge` on push to main.
3. Add `federation.url` to each participating repo's `code-wiki.yaml`.

### Per-repo CI on merge to main
```yaml
on: push: { branches: [main] }
jobs:
  publish:
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g code-wiki
      - run: code-wiki build                             # regenerates wiki + skills
      - run: code-wiki publish                           # pushes fingerprint to federation repo
      - uses: stefanzweifel/git-auto-commit-action       # commits regenerated artifacts with [skip ci]
```

### `code-wiki publish` (mechanics)
1. Clones federation repo to temp dir (shallow).
2. Writes current repo's fingerprint to `fingerprints/<service-name>.json`.
3. Based on `publish_strategy`: creates a branch `fingerprint/<service>-<commit-sha>` and opens a PR, OR pushes directly to main.

### `code-wiki merge` (in federation repo CI)
1. Reads all `fingerprints/*.json`; diffs against previous `graph/*.json` by fingerprint-sha.
2. Normalizes identifiers (lowercase, trim, version-suffix stripping per `analysis.normalize.identifiers`).
3. Rebuilds `graph/services.json`, `edges.json`, `workflows.json`, `tech-matrix.json` incrementally — only if any fingerprint input changed.
4. Regenerates org-wide `wiki/` pages.
5. Commits with `chore(code-wiki): merge N fingerprints [skip ci]` — only if there is a diff.

### Safety posture
- `fingerprints/` directory protected by CODEOWNERS; manual edits require owner review.
- `graph/` directory is generated-only; manual edits are overwritten on next merge. Documented explicitly.
- `code-wiki publish` validates fingerprint schema before pushing — fails loudly on missing fields.

---

## Rollout — six sub-phases

Phase 2 ships in six slices. Each produces a usable increment.

| Slice | Ships | Enables |
|-------|-------|---------|
| **2a — Schema + scanner extensions** | Fingerprint v2.0 schema, `exposes`/`consumes` on all adapters, REST endpoint adapter, `detection_method` / `confidence` fields | Single-repo scans with richer data |
| **2b — Generator refactor** | Workflow pages, api.md, runbook scaffold, glossary.md, narration markers (off) | Richer per-repo wiki |
| **2c — MCP server** | `code-wiki mcp`, 14 tools, `.mcp.json` recipes for Claude Code / amp / opencode | NLP queries against a local graph today |
| **2d — Federation core** | `publish`, `pull`, `merge` commands; `code-wiki-org` repo template | Multi-repo org graph; cross-service edges |
| **2e — Skills generation** | Per-workflow skill files + `org-context` skill, "Related workflows" footer | Claude Code auto-loads context by workflow |
| **2f — Polish** | `init` wizard, `status` command, narration pass, CI recipes (GitHub + Bitbucket) | Onboarding, ops-readiness, opt-in narration |

**Dependencies:**
- 2a unblocks everything (schema stability matters).
- 2b and 2c can run in parallel after 2a — one writes, one reads.
- 2d depends on 2a (fingerprint schema must be stable).
- 2e depends on 2d (skills use the org graph for workflow context).
- 2f depends on all prior.

**Release plan:**
- `v0.2.0` after 2a — richer fingerprints.
- `v0.3.0` after 2b + 2c — single-repo MCP shippable.
- `v0.4.0` after 2d + 2e — federation + skills land together.
- `v0.5.0` after 2f — Phase 2 complete.

---

## Testing strategy

**Unit tests (vitest):**
- Fingerprint schema validation.
- Identifier normalization rules (parameterized).
- Edge-matching logic with synthetic fingerprint pairs.
- Each generator produces expected markdown given canonical graphs.
- MCP tool handlers with mocked graph inputs.

**Integration tests:**
- End-to-end `code-wiki build` on fixture repos (existing + new Go REST fixture).
- `code-wiki publish` → `code-wiki merge` round-trip against a tmpdir git remote.
- MCP server: spawn binary, send JSON-RPC over stdio, assert responses.
- Regeneration idempotence: running `build` twice on unchanged input produces zero new commits.

**Fixtures to add:**
- Go service exposing REST + producing Kafka → paired with existing `kafka-producer` fixture to produce a cross-repo edge.
- A workflow-declared repo to exercise workflow skill generation.

---

## Open questions for implementation

Intentionally deferred to the writing-plans skill. Not blockers for design approval.

1. Exact identifier normalization rules (what does "lowercase + trim + strip version suffixes" mean precisely for Kafka topics vs REST paths vs gRPC services?).
2. REST endpoint detection strategy for each framework (Spring `@RequestMapping`, Go chi `r.Get`, Express `app.get`, FastAPI decorators). Start with Spring + chi + Express; widen as needed.
3. Merge job performance budget at 100 vs 500 vs 1000 fingerprints.
4. `code-wiki init` wizard flow — how much to prompt for vs infer from the repo.
5. Precise mermaid diagram generation (LR vs TB, node grouping by workflow).

---

## Success criteria

- Agent can answer "which services consume topic X?" with a citation in under 500ms on a 50-repo graph.
- Running `code-wiki build` twice on an unchanged repo produces zero new commits (idempotent).
- A new repo added to the federation appears in the org graph within one CI cycle.
- Disabling `federation.enabled` returns the tool to pure single-repo mode with no stale references.
- Skills regenerated by `code-wiki build` activate correctly in Claude Code when relevant services are discussed.

---

## Links

- Phase 1 spec: [`2026-04-12-code-wiki-design.md`](./2026-04-12-code-wiki-design.md)
- Phase 1 implementation plan: [`../plans/2026-04-12-phase1-mvp.md`](../plans/2026-04-12-phase1-mvp.md)
- Phase 2 implementation plan: _to be written via the writing-plans skill_
