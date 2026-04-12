# code-wiki Implementation Roadmap

> **Master plan** — breaks the full design spec into 5 phases, each producing working, testable software. Each phase gets its own detailed implementation plan.

**Design Spec:** `docs/superpowers/specs/2026-04-12-code-wiki-design.md`

---

## Phase Overview

| Phase | Name | What it delivers | Depends on |
|-------|------|-----------------|------------|
| 1 | **MVP — Scan & Build** | CLI scaffold, adapter system, Pass 1 scanner, basic wiki generation, JSON graph | Nothing |
| 2 | **Deep Analysis** | Pass 2 connect, Pass 3 narrate with LLM, SQLite index, full wiki structure | Phase 1 |
| 3 | **Self-Maintenance** | Lint, refresh, CI hooks, staleness detection, incremental updates | Phase 2 |
| 4 | **Agents & Search** | QMD integration, MCP server, composable primitives, persona skills | Phase 2 |
| 5 | **Dashboard & Polish** | Static site dashboard, DAG visualization, init wizard, open-source prep | Phase 3 + 4 |

---

## Phase 1: MVP — Scan & Build

**Goal:** `code-wiki init` (minimal) + `code-wiki scan` (Pass 1 only) + `code-wiki build` (JSON graph + skeleton wiki). Working end-to-end for local directories.

**Delivers:**
- Project scaffold (TypeScript, monorepo structure, CLI entry point)
- Adapter interface + 3 core adapters (Java/Gradle, TypeScript/npm, Kafka config)
- Pass 1 fingerprint scanner across local repos
- JSON graph output (services.json, edges.json)
- Basic markdown wiki skeleton (service overview pages from structural data, no LLM)
- Config file parser (code-wiki.yaml)
- Unit + integration tests throughout

**Success criteria:** Run `code-wiki scan --path ./test-repos` on a set of sample repos and get a populated `services.json`, `edges.json`, and one `services/*/overview.md` per service.

**Detailed plan:** `docs/superpowers/plans/2026-04-12-phase1-mvp.md`

---

## Phase 2: Deep Analysis

**Goal:** Full 3-pass pipeline with LLM integration. Complete wiki output with prose, diagrams, cross-references.

**Delivers:**
- Pass 2: cross-repo connection discovery (Kafka topic matching, REST endpoint matching, Maven/Gradle dep resolution)
- Pass 3: LLM narration (Vercel AI SDK integration, prompt templates, hierarchical generation)
- SQLite index (better-sqlite3, FTS5, recursive CTEs)
- Full wiki structure: overview, api, events, dependencies, data, runbook per service
- Workflow pages: overview, sequence diagram (Mermaid), data-flow, failure-modes, glossary
- Symbol registry for cross-repo matching
- Frontmatter with staleness metadata
- Additional adapters: REST/OpenAPI, gRPC/proto, database/JDBC, Maven/Gradle cross-repo

**Success criteria:** Run full pipeline on 5-6 sample repos representing a workflow. Get a complete wiki with Mermaid sequence diagrams, cross-referenced pages, and a queryable SQLite index.

**Detailed plan:** `docs/superpowers/plans/2026-04-12-phase2-deep-analysis.md` (to be written)

---

## Phase 3: Self-Maintenance

**Goal:** Wiki stays current automatically. Lint detects problems, refresh fixes them, CI hooks automate it.

**Delivers:**
- `code-wiki lint` with staleness detection, broken link check, graph integrity, severity levels
- `code-wiki refresh` with incremental re-scan, blast radius calculation, targeted regeneration
- Token budget guards and graceful degradation
- Scan state tracking (.code-wiki/scan-state.json)
- CI pipeline templates (GitHub Actions, Bamboo)
- PR impact preview command
- Edge case handling (archived repos, renamed services, budget exceeded)

**Success criteria:** Change a Kafka topic name in a test repo, run `code-wiki refresh`, and see only the affected wiki pages regenerated with correct content. `code-wiki lint` detects the change before refresh.

**Detailed plan:** To be written after Phase 2.

---

## Phase 4: Agents & Search

**Goal:** The wiki becomes queryable and actionable through AI agents and MCP.

**Delivers:**
- QMD integration for wiki search/indexing
- MCP server exposing composable primitives (wiki-read, graph-query, graph-impact, etc.)
- Composable primitive layer (all 15 primitives from design spec)
- Persona skill packs: dev (5 skills), QA (4), support (4), BA (4)
- Skill prompting template and authoring guide
- Agent observability logging
- `code-wiki serve` command (MCP server + QMD)

**Success criteria:** Ask the dev agent "What's the blast radius if I change topic X?" and get a correct, cited response that references wiki pages and edge evidence.

**Detailed plan:** To be written after Phase 2.

---

## Phase 5: Dashboard & Polish

**Goal:** Web UI, full init wizard, open-source readiness.

**Delivers:**
- Interactive init wizard (full flow from design spec)
- Static dashboard site (Astro or Next.js static export)
- DAG visualization (D3 or Cytoscape)
- Non-interactive mode / presets
- Git host adapters (Bitbucket, GitHub, GitLab)
- Observability adapters (ELK, Grafana) for live agent queries
- CI/CD adapters (Bamboo, GitHub Actions, Jenkins)
- Open-source prep: README, contributing guide, license, npm package, GitHub Actions CI
- Adapter authoring guide and plugin registry

**Success criteria:** `code-wiki init` walks through full wizard, scans remote repos, builds complete wiki, serves dashboard with interactive DAG, agents answer questions via MCP.

**Detailed plan:** To be written after Phase 3+4.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Tree-sitter WASM bindings unstable in Node.js | Pass 1 accuracy drops | Fall back to regex-based detection; Tree-sitter is enhancement, not required |
| LLM token costs exceed estimates | Budget overruns | Cost controls in config, structural-only fallback, model selection per task |
| Kafka topic names are dynamic/config-driven | Pass 2 misses edges | LLM assist mode for ambiguous connections, manual hints in config |
| QMD doesn't meet search quality bar | Agent answers are poor | QMD is swappable; SQLite FTS5 as fallback search |
| Large monorepos overwhelm scanner | Timeouts, memory issues | Concurrency limits, file-count caps, shallow clone, incremental scan |
