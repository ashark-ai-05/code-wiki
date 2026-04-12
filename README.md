# code-wiki

> A self-maintaining codebase intelligence platform — scans repos, builds a dependency graph from static analysis, and exposes it to agents over MCP so you can query your codebase in natural language.

**Status:** `v0.3.0` — MCP server shipped. Early development. Roadmap below.

## What it does today

1. **Scan** a repo (or a directory of repos) and fingerprint each service's tech stack — languages, frameworks, build tools, Kafka topics, REST endpoints, dependencies. Per-identifier source evidence with file + line.
2. **Build a graph** — services + cross-repo edges (Kafka producer → consumer). Identifiers are normalized so `prod.orders.new.v1` matches `orders.new` across repos.
3. **Generate a wiki** — per-service `overview.md`, `tech-stack.md`, `dependencies.md`, `api.md`, `glossary.md`, `workflows.md`, and a scaffold `runbook.md`. Index + mermaid dependency diagram at the root.
4. **Serve an MCP server** — 14 tools over stdio that any MCP-compatible agent (Claude Code, amp, opencode, copilot-cli) can call. Query the graph with natural language, get structured answers with citations.

## Quickstart

```bash
npm install
npx tsx bin/code-wiki.ts build --path <dir-with-repos> --output ./out
```

That produces `out/index.md`, `out/graph/services.json`, per-service pages, etc.

### Add to Claude Code

In your project, create `.mcp.json`:
```json
{
  "mcpServers": {
    "code-wiki": { "command": "npx", "args": ["tsx", "/abs/path/to/code-wiki/bin/code-wiki.ts", "mcp"] }
  }
}
```

Set `CODE_WIKI_GRAPH=/abs/path/to/out/graph` (or run the agent from the project root and let discovery find `./code-wiki-output/graph/`).

Restart Claude Code. Ask things like:

- *"What services do I have?"*
- *"Which services consume the `orders.new` topic?"*
- *"Where is the order-matching logic?"* (calls `search_files` + `read_file`)
- *"Show me every service using Spring Boot."*

The agent picks the right tools automatically.

## Tools exposed over MCP

| Category | Tools |
|----------|-------|
| **Graph** | `list_services`, `get_service`, `find_by_tech`, `trace_downstream`, `trace_upstream`, `get_edges` |
| **Workflows** | `list_workflows`, `get_workflow` *(stubs until federation lands)* |
| **Code** | `list_files`, `read_file`, `search_files` |
| **Meta** | `stats`, `refresh`, `health` |

Every response is an envelope with `data`, `evidence` (file:line citations), `confidence`, and `sources` metadata.

See [`docs/mcp/client-setup.md`](./docs/mcp/client-setup.md) for per-agent config.

## Supported detectors today

- **Languages:** Java (Maven/Gradle), TypeScript/JavaScript (npm), Go (modules)
- **Communication:** Kafka (Spring config + kafkajs), REST (Go chi)

Express/FastAPI/Spring REST detection and REST consumer detection land in later slices.

## Architecture at a glance

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

Deep design: [`docs/superpowers/specs/2026-04-12-phase2-design.md`](./docs/superpowers/specs/2026-04-12-phase2-design.md)

## Roadmap

- [x] **v0.1.0** — Phase 1 MVP: scanner + graph builder + wiki skeleton + CLI
- [x] **v0.2.0** — Phase 2a: fingerprint v2.0 schema with `exposes`/`consumes` + source evidence, Go chi REST adapter
- [x] **v0.3.0** — Phase 2b + 2c: generator refactor (4 new per-service pages), narration markers, MCP server (14 tools)
- [ ] **v0.4.0** — Phase 2d + 2e: git-native federation, org-wide graph, per-workflow Claude Code skills
- [ ] **v0.5.0** — Phase 2f: `init` wizard, `status` command, narration pass, CI recipes

Phase 2 design and plans live under [`docs/superpowers/`](./docs/superpowers/).

## License

MIT — see [`LICENSE`](./LICENSE).
