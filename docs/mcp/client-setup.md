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
