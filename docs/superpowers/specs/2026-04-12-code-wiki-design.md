# code-wiki: Self-Maintaining Codebase Intelligence Platform

**Date**: 2026-04-12
**Status**: Design approved, pending implementation plan
**Author**: Krunal + Claude

---

## Executive Summary

code-wiki is an open-source CLI tool that analyzes microservice codebases, discovers inter-service dependencies, builds a self-maintaining knowledge wiki, and provides persona-specific AI agents for developers, QA, support, BAs, and other stakeholders.

It combines static code analysis with LLM-powered narrative generation to produce a living, git-versioned wiki backed by a structured dependency graph. The wiki stays current through incremental CI-driven refresh and automated staleness detection.

**Core principles:**
- Wiki-first: git-versioned markdown is the source of truth
- LLM-optional for scanning, LLM-required for narration
- Zero infrastructure for small setups (JSON-only), optional SQLite for scale
- Pluggable adapters for git hosts, artifact registries, observability, CI/CD
- MCP server as the universal agent interface

---

## 1. System Architecture Overview

### CLI Commands

| Command | What it does | LLM needed? |
|---------|-------------|-------------|
| `code-wiki init` | Interactive wizard — generates `code-wiki.yaml` | No |
| `code-wiki scan` | Multi-pass repo analysis — raw findings | Pass 1: No. Pass 2+: Optional |
| `code-wiki build` | Generates wiki markdown, JSON graph, SQLite index | Yes (for prose). DAG/JSON: No |
| `code-wiki serve` | Starts dashboard + QMD search + MCP server | No |
| `code-wiki lint` | Detects staleness, broken links, graph drift | No (optional LLM for fix suggestions) |
| `code-wiki refresh` | Incremental update of changed services/pages | Yes (for prose regeneration) |
| `code-wiki add-workflow` | Deep-scan a new workflow and add to wiki | Yes |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        code-wiki CLI                            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │   init    │  │   scan    │  │   build   │  │   serve    │  │
│  │  wizard   │  │  (multi-  │  │  (wiki +  │  │ (dashboard │  │
│  │          │  │   pass)   │  │   DAG)    │  │  + agents) │  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  │
│        │              │              │              │          │
│  ┌─────▼──────────────▼──────────────▼──────────────▼──────┐  │
│  │                   Core Engine                            │  │
│  │  ┌────────────┐ ┌────────────┐ ┌─────────────────────┐  │  │
│  │  │  Adapter   │ │  Analysis  │ │  Wiki Generator     │  │  │
│  │  │  Registry  │ │  Pipeline  │ │  (LLM Wiki Pattern) │  │  │
│  │  └──────┬─────┘ └──────┬─────┘ └──────────┬──────────┘  │  │
│  │         │              │                   │             │  │
│  │  ┌──────▼──────────────▼───────────────────▼──────────┐  │  │
│  │  │              Plugin / Adapter Layer                 │  │  │
│  │  │  ┌─────┐ ┌──────┐ ┌─────┐ ┌─────┐ ┌───────────┐  │  │  │
│  │  │  │ Git │ │Kafka │ │Maven│ │ DB  │ │Observ-    │  │  │  │
│  │  │  │Hosts│ │Topic │ │Grad.│ │Conn.│ │ability    │  │  │  │
│  │  │  └─────┘ └──────┘ └─────┘ └─────┘ └───────────┘  │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────���──────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Wiki Repo  │    │   SQLite     │    │   QMD Index      │
│  (md + json)│───▶│  (derived)   │    │  (search + MCP)  │
│  git-versioned   └──────────────┘    └────────┬─────────┘
└──────┬──────┘                                 │
       │         ┌──────────────────┐           │
       └────────▶│  Workflow Agents │◀──────────┘
                 │  & Claude Skills │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │    Dashboard     │
                 │  (static site)   │
                 └──────────────────┘
```

### Data Store Strategy (C+ Hybrid)

| Scale | What's active |
|-------|--------------|
| Getting started (< 20 repos) | Markdown + JSON only. Zero setup. |
| Team adoption (20-100 repos) | Add SQLite index. Richer queries, faster dashboard. |
| Org-wide (100+ repos) | SQLite required. Optional graph DB adapter. |

---

## 2. Multi-Pass Analysis Pipeline

Three distinct passes, each building on the last.

### Pass 1: Fingerprint (static, no LLM, all repos)

Scans every repo for structural signals using file-pattern matching, config parsing, and lightweight Tree-sitter AST analysis. No deep code analysis, no LLM. Handles 50 repos in under a minute.

**Output per repo:**

```json
{
  "repo": "credit-gateway",
  "tech_stack": {
    "languages": ["java:17", "typescript:5.x"],
    "frameworks": ["spring-boot:3.2", "react:18"],
    "build": ["gradle:8.x", "npm"],
    "runtime": ["docker", "kubernetes"]
  },
  "communication": {
    "exposes": ["rest-api", "websocket", "kafka-producer"],
    "consumes": ["kafka-consumer", "grpc-client", "jdbc"]
  },
  "entry_points": {
    "api_specs": ["src/main/resources/openapi.yaml"],
    "kafka_configs": ["src/main/resources/kafka-topics.yaml"],
    "db_configs": ["src/main/resources/application.yaml"]
  },
  "ownership": {
    "team": "credit-risk",
    "codeowners": [".github/CODEOWNERS"]
  },
  "ci_cd": "bamboo",
  "deploy_target": "kubernetes"
}
```

**Adapter-driven detection:**

```
adapters/
├── languages/
│   ├── java.ts        # pom.xml, build.gradle -> version, deps
│   ├── typescript.ts  # package.json -> version, deps
│   ├── python.ts      # pyproject.toml, requirements.txt
│   ├── go.ts          # go.mod
│   └── rust.ts        # Cargo.toml
├── communication/
│   ├── kafka.ts       # topic configs, producer/consumer annotations
│   ├── rest.ts        # OpenAPI specs, Feign clients, controller annotations
│   ├── grpc.ts        # .proto files
│   ├── websocket.ts   # WS endpoint annotations/configs
│   └── database.ts    # JDBC URLs, connection pool configs
├── infrastructure/
│   ├── docker.ts      # Dockerfile, docker-compose
│   ├── kubernetes.ts  # Helm charts, k8s manifests
│   └── terraform.ts   # .tf files
└── ci_cd/
    ├── bamboo.ts      # bamboo-specs/
    ├── github-actions.ts
    └── jenkins.ts     # Jenkinsfile
```

Additional Pass 1 outputs:
- CODEOWNERS / team metadata capture
- File manifest summaries (key directories, controller counts, consumer counts)
- Module/component detection via Tree-sitter heuristics

### Pass 2: Connect (static + optional LLM, targeted repos)

For repos in a specific workflow, performs deep code analysis to find actual connections. Builds the DAG edges.

| Connection Type | Discovery Method | Confidence |
|----------------|-----------------|------------|
| Kafka | Match producer topic names -> consumer topic names across repos | 90% static |
| REST API | Parse OpenAPI specs, Feign clients, RestTemplate URLs -> controller endpoints | 80% static |
| Maven/Gradle dep | Match groupId:artifactId in published artifacts -> dependency declarations | 100% static |
| gRPC | Match .proto service definitions -> client stubs | 100% static |
| Shared DB | Match JDBC URLs / schema names across services | 90% static |
| WebSocket | Grep for WS URLs, connection handlers | 70% static |
| File/S3 | Match S3 bucket names, file path patterns | 80% static |

**Edge output format:**

```json
{
  "id": "e001",
  "from": "credit-gateway",
  "to": "risk-calc",
  "type": "kafka",
  "details": {
    "topic": "credit.check.requests",
    "serialization": "avro",
    "schema_registry": true
  },
  "evidence": {
    "from_file": "src/main/java/com/org/credit/CreditCheckProducer.java",
    "from_line": 42,
    "to_file": "src/main/java/com/org/risk/CreditCheckConsumer.java",
    "to_line": 18
  },
  "confidence": "static",
  "discovered_at": "2026-04-12T10:05:00Z"
}
```

Key features:
- Central symbol registry maintained between passes to avoid re-scanning
- Evidence snippets (file + line range) on every edge for traceability
- LLM-inferred edges flagged with `"confidence": "inferred"` vs `"confidence": "static"`
- Lightweight intra-repo call graph via Tree-sitter for complex internal flows

### Pass 3: Narrate (LLM required, targeted repos)

Takes structural data from Pass 1+2 and generates human-readable wiki content using hierarchical generation: leaf-level pages first (API endpoints, individual modules), then synthesized overviews.

**Generated content types:**
- Service overview pages (business context)
- API documentation (from OpenAPI + code analysis)
- Dependency narratives (why service A depends on B)
- Workflow sequence diagrams (Mermaid)
- Runbooks (for support: what to check when this service fails)
- Business glossary (code concept -> business term mapping)

**Page frontmatter:**

```yaml
---
generated_by: code-wiki
generated_at: 2026-04-12T10:00:00Z
summary: "Credit gateway service — entry point for all credit check requests, routes to risk-calc via Kafka"
source_repos: ["credit-gateway"]
source_pass: "narrate"
staleness_check: "git:credit-gateway:main:abc123"
tags: ["credit", "gateway", "kafka", "spring-boot"]
---
```

**Prompt engineering guardrails for Pass 3:**
- Ground all statements in specific code artifacts (file paths, function names, config keys)
- Require explicit business-to-code mapping in glossary
- Include self-review step: cross-check prose against structural data
- One-line summary at top of every page

**Post-narration validation step:**
- Check for broken Mermaid syntax
- Verify all wiki-links resolve
- Confirm frontmatter completeness
- Flag any "TBD" or placeholder content

---

## 3. Wiki Structure & Graph Schema

### Directory Layout

```
code-wiki-output/                   # root of the wiki repo
├── code-wiki.yaml                  # project config (from init wizard)
├── index.md                        # master index (auto-generated)
├── log.md                          # chronological change log
│
├── graph/                          # machine-readable
│   ├── services.json               # all service nodes
│   ├── edges.json                  # all connections between services
│   ├── workflows.json              # workflow metadata + business context
│   ├── workflows/
│   │   ├── credit-checking.json    # subgraph for this workflow
│   │   └── pricing.json
│   ├── tech-matrix.json            # tech stack across all services
│   └── schema-version.json         # graph schema version for migrations
│
├── services/                       # one dir per service
│   ├── credit-gateway/
│   │   ├── overview.md             # what it does, business context, team
│   │   ├── tech-stack.md           # languages, frameworks, build, runtime
│   │   ├── api.md                  # endpoints, request/response, auth
│   │   ├── events.md               # kafka topics produced/consumed
│   │   ├── dependencies.md         # upstream/downstream services, shared DBs
│   │   ├── data.md                 # DB schemas, data flows, storage
│   │   └── runbook.md              # ops: health checks, common failures
│   └── risk-calc/
│       └── ...
│
├── workflows/                      # cross-service flows
│   └── credit-checking/
│       ├── overview.md             # business-readable
│       ├── sequence.md             # technical flow with Mermaid
│       ├── data-flow.md            # data movement and transformations
│       ├── failure-modes.md        # what breaks, blast radius, recovery
│       └── glossary.md             # business term <-> code concept
│
├── architecture/                   # org-wide views
│   ├── overview.md                 # high-level system architecture
│   ├── tech-radar.md               # tech adoption status
│   ├── shared-libraries.md         # common libs, versions, consumers
│   └── infrastructure.md           # deploy targets, environments
│
├── diagrams/                       # auto-generated
│   ├── full-dag.mmd               # Mermaid source
│   ├── full-dag.svg               # rendered
│   ├── credit-checking-sequence.mmd
│   ├── credit-checking-sequence.svg
│   └── credit-checking-c4.mmd     # C4-model inspired architecture
│
└── .code-wiki/                     # internal state (git-tracked)
    ├── fingerprints/               # Pass 1 raw output per repo
    │   ├── credit-gateway.json
    │   └── risk-calc.json
    ├── edges-raw/                  # Pass 2 raw edges with evidence
    │   └── credit-checking.json
    ├── symbol-registry.json        # central registry for cross-repo matching
    ├── scan-state.json             # last scan timestamps, git SHAs per repo
    └── index.db                    # SQLite (when index_mode: sqlite)
```

### Graph Schema

**services.json:**

```json
{
  "schema_version": "1.0",
  "services": [
    {
      "id": "credit-gateway",
      "repo": "bitbucket:my-org/credit-gateway",
      "type": "microservice",
      "team": "credit-risk",
      "tech_stack": {
        "languages": ["java:17"],
        "frameworks": ["spring-boot:3.2"],
        "build": ["gradle:8.x"],
        "runtime": ["kubernetes"],
        "databases": ["oracle:19c"]
      },
      "exposes": ["rest-api", "kafka-producer", "websocket"],
      "consumes": ["kafka-consumer", "grpc-client"],
      "deploy_envs": ["dev", "uat", "prod"],
      "last_scanned": "2026-04-12T10:00:00Z",
      "scan_sha": "abc123"
    }
  ]
}
```

**edges.json:**

```json
{
  "schema_version": "1.0",
  "edges": [
    {
      "id": "e001",
      "from": "credit-gateway",
      "to": "risk-calc",
      "type": "kafka",
      "bidirectional": false,
      "details": {
        "topic": "credit.check.requests",
        "serialization": "avro",
        "schema_registry": true
      },
      "evidence": {
        "from_file": "src/main/java/com/org/credit/CreditCheckProducer.java",
        "from_line": 42,
        "to_file": "src/main/java/com/org/risk/CreditCheckConsumer.java",
        "to_line": 18
      },
      "confidence": "static",
      "discovered_at": "2026-04-12T10:05:00Z",
      "workflows": ["credit-checking"]
    }
  ]
}
```

**workflows.json:**

```json
{
  "schema_version": "1.0",
  "workflows": [
    {
      "id": "credit-checking",
      "name": "Credit Checking",
      "description": "End-to-end credit check and risk assessment flow",
      "owner_team": "credit-risk",
      "business_impact": "high",
      "tags": ["credit", "risk", "compliance"],
      "service_ids": ["credit-gateway", "risk-calc", "pricing-engine", "audit-logger", "common-models"],
      "entry_points": ["credit-gateway", "credit-api"]
    }
  ]
}
```

### Cross-Referencing Strategy

Wiki-links for internal cross-referencing with standard markdown fallback:

```markdown
## Dependencies

This service produces to the [[credit.check.requests]] Kafka topic,
consumed by [[risk-calc]]. See the full flow in
[[workflows/credit-checking/sequence|Credit Checking Sequence]].
```

- Resolvable by QMD for search
- Renderable by dashboard as hyperlinks
- Checkable by `code-wiki lint` for broken references
- Navigable in Obsidian for local browsing
- Falls back to standard `[text](path)` for GitHub rendering

Auto-generated "See Also" sections at bottom of every page, derived from edge graph.

### SQLite Derived Index

Built from `graph/*.json` on `code-wiki build` or `code-wiki refresh`:

```sql
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  repo TEXT,
  type TEXT,
  team TEXT,
  tech_stack_json TEXT,
  last_scanned TEXT,
  scan_sha TEXT
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  from_svc TEXT REFERENCES services(id),
  to_svc TEXT REFERENCES services(id),
  type TEXT,
  details_json TEXT,
  confidence TEXT,
  bidirectional BOOLEAN DEFAULT FALSE
);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  owner_team TEXT,
  business_impact TEXT,
  service_ids_json TEXT
);

CREATE VIRTUAL TABLE wiki_pages USING fts5(
  path, title, summary, content, service, workflow, tags
);

-- Example: "What's within 3 hops of credit-gateway?"
WITH RECURSIVE reachable(svc, depth) AS (
  VALUES('credit-gateway', 0)
  UNION
  SELECT e.to_svc, r.depth + 1
  FROM edges e JOIN reachable r ON e.from_svc = r.svc
  WHERE r.depth < 3
)
SELECT DISTINCT svc, depth FROM reachable;
```

---

## 4. Agents, Skills & Persona Workflows

### Architecture

```
┌──────────────────────────────────┐
│     Persona Skill Layer          │
│  ┌─────┐┌────┐┌─────┐┌────┐    │
│  │ Dev ││ QA ││Supp.││ BA │    │
│  └──┬──┘└──┬─┘└──┬──┘└──┬─┘    │
└─────┼──────┼─────┼──────┼───────┘
      │      │     │      │
┌─────▼──────▼─────▼──────▼───────┐
│    Composable Primitives         │
│  wiki-read, wiki-search,        │
│  graph-query, graph-impact,     │
│  graph-workflow, repo-browse,   │
│  repo-search, trace-request,    │
│  trace-logs, tech-lookup,       │
│  who-owns, list-workflows,      │
│  get-frontmatter, ci-status,    │
│  generate-mermaid                │
└────────┬────────────┬────────────┘
         │            │
┌────────▼──┐  ┌──────▼──────────┐
│ QMD Index │  │ SQLite + Wiki   │
│ (MCP)     │  │ Files           │
└───────────┘  └────────┬────────┘
                        │
             ┌──────────▼─────────┐
             │  Live Systems      │
             │  (optional)        │
             │  ELK, Grafana, etc │
             └────────────────────┘
```

### Layer 1: Composable Primitives

| Primitive | What it does | Data source |
|-----------|-------------|-------------|
| `wiki-read` | Read a specific wiki page by path | Wiki markdown files |
| `wiki-search` | Semantic search across wiki | QMD MCP server |
| `graph-query` | Query service graph (neighbors, paths, subgraphs) | SQLite / JSON |
| `graph-impact` | Blast radius analysis | SQLite recursive CTEs |
| `graph-workflow` | Get all services, edges, sequence for a workflow | Workflow JSON + markdown |
| `repo-browse` | Read source code from a repo | Git provider |
| `repo-search` | Search across repos for a pattern | Git provider |
| `trace-request` | Trace a request ID across services | Observability adapter |
| `trace-logs` | Fetch logs for a service + time range | Observability adapter |
| `tech-lookup` | Tech stack for service X | services.json |
| `who-owns` | Team ownership for a service/workflow | services.json + CODEOWNERS |
| `list-workflows` | List all defined workflows | workflows.json |
| `get-frontmatter` | Read page metadata (staleness, tags) | Wiki markdown |
| `ci-status` | Build/deploy status for a service | CI/CD adapter |
| `generate-mermaid` | Generate a diagram on demand | LLM + graph data |

### Layer 2: Persona Skills

**Developer Agent** (`skills/dev/`)

| Skill | Purpose | Composes |
|-------|---------|----------|
| `trace-flow` | Show full request flow for a workflow | `graph-workflow` -> `wiki-read` (sequence.md) -> render Mermaid |
| `blast-radius` | Impact of changing a topic/API/schema | `graph-impact` -> `wiki-read` (deps for each affected) |
| `onboard-me` | Get up to speed on a workflow | `graph-workflow` -> `wiki-read` (overviews + tech-stack) -> `repo-browse` (entry points) |
| `find-usage` | Who consumes a proto/API/topic? | `repo-search` -> `graph-query` to contextualize |
| `change-plan` | Migration checklist for a schema change | `graph-impact` -> `wiki-read` (api, events) -> generate plan |

**QA Agent** (`skills/qa/`)

| Skill | Purpose | Composes |
|-------|---------|----------|
| `test-map` | Test coverage for a flow | `graph-workflow` -> `repo-search` (test files) -> summarize |
| `regression-scope` | What needs regression testing? | `graph-impact` -> `wiki-read` (api, events) -> test plan |
| `gen-scenarios` | Generate integration test scenarios | `graph-workflow` -> `wiki-read` (sequence, failure-modes) -> LLM |
| `env-check` | Environment readiness for testing | `graph-workflow` -> `ci-status` per service |

**Support Agent** (`skills/support/`)

| Skill | Purpose | Composes |
|-------|---------|----------|
| `trace-incident` | Trace a failed request | `trace-request` -> `trace-logs` -> `wiki-read` (runbook) |
| `diagnose` | Service returning errors | `wiki-read` (runbook) -> `trace-logs` -> `graph-query` (upstream) |
| `escalation-path` | Who to escalate to | `who-owns` -> `wiki-read` (overview for team context) |
| `impact-assess` | Business impact of an outage | `graph-impact` -> `wiki-read` (workflow overviews) -> business summary |

**BA / Business SME Agent** (`skills/ba/`)

| Skill | Purpose | Composes |
|-------|---------|----------|
| `explain-workflow` | Business explanation of a workflow | `wiki-read` (overview + glossary) |
| `data-lineage` | Where does data flow? | `graph-query` (path) -> `wiki-read` (data.md per hop) |
| `change-impact-biz` | Business process impact | `wiki-search` -> `graph-impact` -> business summary |
| `audit-trail` | Data flow for compliance | `graph-workflow` -> `wiki-read` (data-flow) -> highlight compliance |

**Dashboard Agent** (`skills/dashboard/`)

| Skill | Purpose | Composes |
|-------|---------|----------|
| `generate-site` | Build static dashboard | Read all graph JSON + markdown -> generate HTML |
| `refresh-views` | Update after wiki refresh | Incremental rebuild of affected pages |
| `export-dag` | Interactive DAG visualization | `graph-query` (full) -> D3/Cytoscape JSON |

**Extension Packs** (future):
- `skills/sre/` — Platform/SRE: deprecated lib detection, tech debt radar, infra health
- `skills/security/` — Security/Compliance: PII data flow audit, public endpoint scan

### Skill Prompting Template

Standardized format for all skill markdown files:

```markdown
---
name: blast-radius
persona: dev
description: "Analyze impact of changing a service, topic, or API"
primitives: [graph-impact, wiki-read, graph-query]
---

## Goal
Determine the full blast radius of a proposed change and generate
a migration checklist.

## Available Primitives
- graph-impact: find all affected services within N hops
- wiki-read: get detailed dependency/API/event info per service
- graph-query: traverse specific edge types

## Reasoning Steps
1. Identify the change target (service, topic, endpoint, schema)
2. Use graph-impact to find all affected services (default: 3 hops)
3. For each affected service, read events.md and api.md
4. Classify impact: DIRECT (consumer/producer) vs INDIRECT (N hops)
5. Generate migration order based on dependency direction
6. Cite evidence for each impact (file + line from edge data)

## Output Format
- Summary: what's affected and why
- Impact table: service, impact type, confidence, evidence
- Migration checklist: ordered steps
- Links: relevant wiki pages
- Always cite sources with [[wiki/path]] links
- Flag any low-confidence inferences explicitly
```

### MCP Server Interface

Primitives exposed as MCP tools for any LLM client:

```json
{
  "tools": [
    {
      "name": "wiki_search",
      "description": "Semantic search across the code wiki",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "scope": { "enum": ["all", "services", "workflows", "architecture"] },
          "service": { "type": "string" }
        },
        "required": ["query"]
      }
    },
    {
      "name": "graph_query",
      "description": "Query the service dependency graph",
      "inputSchema": {
        "type": "object",
        "properties": {
          "from_service": { "type": "string" },
          "max_hops": { "type": "integer", "default": 2 },
          "edge_types": {
            "type": "array",
            "items": { "enum": ["kafka", "rest", "grpc", "maven", "database", "s3", "websocket"] }
          },
          "direction": { "enum": ["downstream", "upstream", "both"] }
        },
        "required": ["from_service"]
      }
    },
    {
      "name": "graph_impact",
      "description": "Blast radius analysis for a change",
      "inputSchema": {
        "type": "object",
        "properties": {
          "target": { "type": "string" },
          "change_type": { "enum": ["schema", "removal", "api_change", "downtime"] },
          "max_depth": { "type": "integer", "default": 3 }
        },
        "required": ["target"]
      }
    },
    {
      "name": "trace_request",
      "description": "Trace a request ID across services",
      "inputSchema": {
        "type": "object",
        "properties": {
          "request_id": { "type": "string" },
          "time_range": { "type": "string" }
        },
        "required": ["request_id"]
      }
    }
  ]
}
```

### Agent Observability

All primitive calls and skill executions are logged:

```json
{
  "skill": "blast-radius",
  "persona": "dev",
  "timestamp": "2026-04-12T10:30:00Z",
  "primitives_called": [
    { "name": "graph-impact", "tokens": 0, "duration_ms": 45 },
    { "name": "wiki-read", "tokens": 0, "duration_ms": 12, "count": 5 }
  ],
  "llm_calls": [
    { "purpose": "synthesize_impact", "tokens_in": 3200, "tokens_out": 800 }
  ],
  "total_cost_usd": 0.012
}
```

---

## 5. Init Wizard & Configuration Schema

### Interactive Init Flow

```
$ code-wiki init

  code-wiki - Codebase Intelligence

? Where are your repositories hosted?
  > Bitbucket Cloud / Server / GitHub / GitLab / Local / Mixed

? Bitbucket workspace: my-org
? Authentication: SSH key (detected: ~/.ssh/id_rsa)

? Scanning all 50 repositories...
  Fingerprinting... 100%

  Detected tech stacks:
  | Java/Spring | 28 | Node.js | 12 | Python | 4 | React/TS | 3 |

  Detected communication patterns:
  | Kafka | 22 | REST API | 31 | gRPC | 8 | Shared DB | 6 |

? Define a workflow to deep-scan? Yes
? Workflow name: credit-checking
? Select entry point service(s): credit-gateway, credit-api
? Auto-discover connected services? Yes

  Found: risk-calc (kafka), pricing-engine (rest),
         audit-logger (kafka), common-models (maven)

? Review discovered services? [edit list]
? Include all? Yes

? Build artifact registry? Artifactory (URL: ...)
? Observability? ELK + Grafana
? LLM provider? Anthropic (claude-sonnet-4-6)
? Wiki output location? ./code-wiki-output
? Index mode? SQLite (recommended for 50 repos)

Config written to code-wiki.yaml
.env.example generated (add your API keys)
Run: code-wiki scan --workflow credit-checking
```

Flags for non-interactive use:
- `code-wiki init --non-interactive --preset=enterprise`
- `code-wiki init --non-interactive --preset=oss-minimal`
- `code-wiki init --non-interactive --config=path/to/existing.yaml`

### Configuration Schema: `code-wiki.yaml`

```yaml
version: "1.0"

# --- Source Repositories ---
sources:
  - provider: bitbucket-cloud
    workspace: my-org
    auth:
      method: ssh
      key_path: ~/.ssh/id_rsa
    include: []
    exclude: ["archived-*", "sandbox-*"]
  # Support multiple providers:
  # - provider: local
  #   paths: ["../other-repo"]

# --- Workflows ---
workflows:
  credit-checking:
    description: "End-to-end credit check and risk assessment"
    entry_points: ["credit-gateway", "credit-api"]
    auto_discover: true
    auto_add_discovered_services: true
    discovered_services:
      - risk-calc
      - pricing-engine
      - audit-logger
      - common-models
    tags: ["credit", "risk", "compliance"]
    # Per-workflow LLM override:
    # llm_model: claude-opus-4-6

# --- Artifact Registry ---
artifacts:
  provider: artifactory
  url: https://artifactory.myorg.com
  auth:
    method: token
    env_var: ARTIFACTORY_TOKEN

# --- Observability ---
observability:
  logs:
    provider: elk
    url: https://elk.myorg.com
    index_pattern: "services-*"
    auth: { method: token, env_var: ELK_TOKEN }
  tracing:
    provider: grafana
    url: https://grafana.myorg.com
    auth: { method: token, env_var: GRAFANA_TOKEN }
  correlation_id:
    header: "X-Request-Id"
    log_field: "request_id"

# --- LLM Configuration ---
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  api_key_env: ANTHROPIC_API_KEY
  usage:
    pass_1_fingerprint: false
    pass_2_connect: optional
    pass_3_narrate: true
    lint: true
  cost_controls:
    max_tokens_per_run: 500000
    warn_above: 100000
    budget_exceeded_behavior: structural_only  # fall back to no-LLM

# --- Output ---
output:
  wiki_path: ./code-wiki-output
  git_enabled: true
  index_mode: sqlite
  sqlite_path: ./code-wiki-output/.code-wiki/index.db
  diagram_format: mermaid
  render_diagrams: true
  markdown_style: github  # github | obsidian | standard

# --- Analysis Settings ---
analysis:
  scan:
    shallow_all_repos: true
    deep_workflows_only: true
    tree_sitter_parsing: true
    max_concurrency: 4
  detection:
    kafka: true
    rest_api: true
    grpc: true
    database: true
    maven_gradle: true
    npm: true
    websocket: true
    s3: true
    file_sharing: true
  staleness:
    check_on_serve: true
    max_age_days: 7

# --- CI/CD ---
adapters:
  ci_cd:
    provider: bamboo
    url: https://bamboo.myorg.com
  custom: []
```

### Adapter Plugin Interface

```typescript
interface CodeWikiAdapter {
  name: string;
  type: 'git-host' | 'artifact-registry' | 'observability' |
        'ci-cd' | 'communication' | 'infrastructure';

  // Discovery (Pass 1)
  detect(repoPath: string): Promise<DetectionResult>;

  // Connection finding (Pass 2)
  findConnections?(repoPath: string, registry: SymbolRegistry): Promise<Edge[]>;

  // Live queries (for agents)
  query?(params: Record<string, unknown>): Promise<QueryResult>;

  // Health check (for serve/dashboard)
  healthCheck?(): Promise<{ healthy: boolean; message: string }>;
}
```

---

## 6. Self-Maintenance Loop

### Mechanism 1: `code-wiki lint` (Detective)

Detects problems without fixing them. No LLM required for detection.

**Staleness detection algorithm:**

```
For each wiki page:
  1. Read frontmatter -> get source_repos[] and scan_sha
  2. For each source repo:
     git ls-remote -> get current HEAD
     if HEAD != scan_sha -> page is STALE
  3. Assess severity:
     git log scan_sha..HEAD --stat -> what files changed?
     src/ changes -> content likely affected (WARNING)
     only tests/docs -> low priority (INFO)
  4. For edge-related pages:
     Re-run Pass 2 detectors on changed files only
     Compare new edges vs stored edges -> flag drift (ERROR)
```

**Lint checks:**

| Category | Check | Severity |
|----------|-------|----------|
| Staleness | Page source repo HEAD has moved | WARNING |
| Staleness | Edge data no longer matches code | ERROR |
| Consistency | Broken wiki-links | ERROR |
| Consistency | Orphan pages (service archived/removed) | WARNING |
| Consistency | Missing pages (service in graph, no wiki page) | WARNING |
| Graph | Edge drift (topic/endpoint renamed) | ERROR |
| Graph | New unindexed service detected | INFO |
| Graph | Circular dependency in workflow DAG | ERROR |
| Content | Broken Mermaid syntax | WARNING |
| Content | Missing frontmatter fields | WARNING |
| Content | Placeholder/TBD content remaining | WARNING |

**CLI flags:**
- `--fail-on-error` — exit code 1 if any ERROR severity (for CI)
- `--fail-on-warning` — exit code 1 if any WARNING or above
- `--suggest-fixes` — use LLM to propose concrete fixes
- `--fix` — auto-fix what's possible (broken links, missing frontmatter)
- `--report <path>` — write JSON report for dashboards

### Mechanism 2: `code-wiki refresh` (Surgeon)

Incremental update — only re-scans and regenerates what changed.

**Refresh algorithm:**

```
refresh(workflow):
  # 1. Detect what changed
  changed_repos = []
  for repo in workflow.services:
    current_sha = git_remote_head(repo)
    last_sha = scan_state[repo].sha
    if current_sha != last_sha:
      changed_files = git_diff_files(last_sha, current_sha)
      changed_repos.push({ repo, changed_files, current_sha })

  # 2. Determine blast radius in the wiki
  affected_pages = []
  for { repo, changed_files } in changed_repos:
    if any src/ files changed:
      affected_pages.push(services/{repo}/*.md)
    if any kafka/api/db config changed:
      affected_pages.push(services/{repo}/events.md, api.md, deps.md)
      for wf in workflows_containing(repo):
        affected_pages.push(workflows/{wf}/sequence.md, data-flow.md)
    if any build files changed:
      re_run_pass_1(repo)
      re_run_pass_2(repo, symbol_registry)

  # 3. Check token budget
  estimated_tokens = estimate_cost(affected_pages)
  if estimated_tokens > cost_controls.max_tokens_per_run:
    if budget_exceeded_behavior == 'structural_only':
      # Update graph JSON and SQLite, skip prose regeneration
      # Flag pages for full narrate on next run
    else:
      warn_user(estimated_tokens)

  # 4. Regenerate only affected pages
  for page in deduplicate(affected_pages):
    regenerate(page)

  # 5. Handle discovered services
  if auto_add_discovered_services:
    for new_service in newly_discovered:
      add_to_workflow(new_service)
      generate_full_service_pages(new_service)
  else:
    prompt_user(newly_discovered)

  # 6. Validate and commit
  run_lint(fix=true)
  update_index()
  update_log()
  git_commit(summary)
  update_scan_state(changed_repos)
```

**CLI flags:**
- `--workflow <name>` — refresh specific workflow
- `--repo <name>` — refresh pages related to one repo
- `--all-workflows` — refresh everything
- `--dry-run` — show what would change + estimated token cost
- `--structural-only` — skip LLM, update graph/SQLite only
- `--commit <sha>` — refresh based on specific commit (for CI hooks)

### Mechanism 3: CI/CD Integration

**Option A: Post-merge hook (recommended starting point)**

```yaml
# Add to each service repo's CI pipeline
code-wiki-refresh:
  stage: post-deploy
  trigger: merge to main
  script:
    - npx code-wiki refresh --repo ${REPO_NAME} --commit ${GIT_SHA}
    - npx code-wiki lint --fail-on-error
```

**Option B: Scheduled full refresh**

```yaml
code-wiki-nightly:
  schedule: "0 2 * * *"
  script:
    - npx code-wiki refresh --all-workflows
    - npx code-wiki lint --report ./lint-report.json
    - npx code-wiki dashboard --build
```

**Option C: PR-time impact preview**

```yaml
code-wiki-preview:
  trigger: pull-request
  script:
    - npx code-wiki impact --diff ${PR_DIFF}
    # Posts PR comment:
    # "This change affects: 2 wiki pages, 1 edge update
    #  Blast radius: 3 downstream services
    #  Estimated refresh cost: ~12K tokens ($0.04)"
```

**Option D: Local dev hook**

```bash
# .git/hooks/pre-push
npx code-wiki lint --quick  # fast structural checks only
```

### Cost Model

| Operation | Frequency | LLM tokens | Est. cost |
|-----------|-----------|------------|-----------|
| Initial full scan (50 repos) | Once | ~500K | ~$1.50 |
| Initial wiki generation (6 services) | Once | ~200K | ~$0.60 |
| Per-merge refresh (1 repo) | Per merge | ~10-20K | ~$0.03-0.06 |
| Nightly full lint | Daily | ~50K | ~$0.15 |
| Weekly full refresh (6 services) | Weekly | ~100K | ~$0.30 |
| **Monthly steady state** | | | **~$5-15** |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Repo archived/removed | Lint detects as orphan. `--fix` offers to archive wiki pages and remove from graph. |
| Service renamed | Lint detects broken links. `--fix` updates all references and renames wiki directory. |
| Large monorepo (many files change) | Graceful degradation: structural-only refresh first, full narrate queued for next nightly run. |
| LLM rate limit during refresh | Partial success: commit what succeeded, flag remaining pages as STALE for retry. |
| Token budget exceeded | Fall back to `structural_only` mode per config. Graph stays current, prose deferred. |

---

## 7. Maintenance Lifecycle

```
┌──────────────────────────────────────┐
│         Codebase Changes             │
│    (developers push to repos)        │
└──────────────┬───────────────────────┘
               │
 ┌─────────────▼──────────────┐
 │    CI Hook (post-merge)    │
 │   code-wiki refresh --repo │
 └─────────────┬──────────────┘
               │
┌──────────────▼───────────────┐
│     Incremental Update       │
│  - re-scan changed files     │
│  - update affected edges     │
│  - regenerate stale pages    │
│  - validate & commit         │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│     Nightly Lint & Audit     │
│  - full consistency check    │
│  - orphan detection          │
│  - graph integrity           │
│  - cost/usage reporting      │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│     Dashboard Rebuild        │
│  - static site regeneration  │
│  - DAG visualization update  │
│  - search index refresh      │
└──────────────────────────────┘
```

---

## Appendix A: End-to-End Flow Example

**Scenario:** A developer renames a Kafka topic from `credit.requests` to `credit.check.v2` in the `credit-gateway` repo.

1. **Developer pushes to main** in `credit-gateway` repo

2. **CI hook triggers**: `code-wiki refresh --repo credit-gateway --commit def456`

3. **Refresh Phase 1 — Detect changes**:
   - Compares scan_state SHA (abc123) with new HEAD (def456)
   - Finds changed file: `src/main/java/.../CreditCheckProducer.java`
   - Identifies: Kafka config change (topic rename)

4. **Refresh Phase 2 — Re-scan**:
   - Re-runs Pass 2 Kafka detector on credit-gateway
   - Detects: topic `credit.requests` is now `credit.check.v2`
   - Updates edge e001 in edges.json
   - Flags downstream consumers (risk-calc, audit-logger) for verification

5. **Refresh Phase 3 — Regenerate**:
   - Updates: `services/credit-gateway/events.md` (new topic name)
   - Updates: `workflows/credit-checking/sequence.md` (diagram updated)
   - Flags: `services/risk-calc/events.md` as potentially stale
   - Flags: `services/audit-logger/events.md` as potentially stale

6. **Refresh Phase 4 — Validate & Commit**:
   - Lint: fixes wiki-link from `[[credit.requests]]` to `[[credit.check.v2]]`
   - Validates Mermaid diagrams render correctly
   - Commits: "wiki: refresh credit-gateway (kafka topic rename credit.requests -> credit.check.v2)"
   - Updates scan-state.json for credit-gateway

7. **Nightly lint** catches:
   - risk-calc and audit-logger still consume old topic name
   - Reports as ERROR: "Edge drift — risk-calc still references credit.requests"

8. **Developer queries agent**: "What's the blast radius of the credit.check.v2 topic change?"
   - `blast-radius` skill activates
   - `graph-impact` finds 5 affected services
   - Returns migration checklist with deployment order

9. **Dashboard updates** on next rebuild — DAG shows updated edge, flagged services highlighted

---

## Appendix B: Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Core runtime | TypeScript / Node.js | QMD is Node, MCP SDKs are TS, unified contributor experience |
| CLI framework | Commander.js or oclif | Mature, supports interactive prompts and plugins |
| AST parsing | Tree-sitter (WASM bindings) | Fast, multi-language, lightweight |
| Build file parsing | Custom parsers per format | XML (pom), Groovy (gradle), JSON (package.json), TOML, YAML |
| SQLite | better-sqlite3 | Synchronous, fast, zero-config, FTS5 support |
| Search index | QMD | Local hybrid search (BM25 + vector + LLM reranking), MCP server |
| LLM integration | Vercel AI SDK | Provider-agnostic (Anthropic, OpenAI, Ollama), streaming, tool calling |
| MCP server | @modelcontextprotocol/sdk | Standard MCP server implementation |
| Diagram rendering | Mermaid CLI (mmdc) | SVG generation from .mmd source |
| Dashboard | Static site generator (Astro or Next.js static export) | Lightweight, renders from wiki data |
| Git operations | simple-git | Programmatic git for Node.js |
| Interactive prompts | Inquirer.js or @clack/prompts | Modern, styled CLI prompts for init wizard |

---

## Appendix C: Open Source Considerations

- **License**: To be decided (MIT or Apache 2.0 recommended)
- **Repository**: GitHub public repo
- **Minimum viable demo**: Init wizard + Pass 1 scanner + basic wiki generation for a small set of public repos
- **Documentation**: README, getting started guide, adapter authoring guide
- **CI/CD**: GitHub Actions for testing, npm publish
- **Community**: Issue templates, contributing guide, adapter plugin registry
