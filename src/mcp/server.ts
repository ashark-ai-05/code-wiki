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
