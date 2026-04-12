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
