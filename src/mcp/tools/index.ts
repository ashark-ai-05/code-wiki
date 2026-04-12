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

import {
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool,
} from './graph.js';
import {
  listWorkflowsTool,
  getWorkflowTool,
} from './workflows.js';
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
} from './code.js';
import {
  statsTool,
  refreshTool,
  healthTool,
} from './meta.js';

export const ALL_TOOLS: McpTool[] = [
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool,
  listWorkflowsTool,
  getWorkflowTool,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  statsTool,
  refreshTool,
  healthTool,
];
