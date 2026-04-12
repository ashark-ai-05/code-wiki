import { existsSync } from 'node:fs';
import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

export const statsTool: McpTool = {
  name: 'stats',
  description:
    'Counts and freshness of the loaded graph. Use this to check whether a refresh is needed.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: {
        service_count: reader.services().length,
        edge_count: reader.edges().length,
        graph_path: reader.graphDir,
        graph_freshness_seconds: reader.freshnessSeconds(),
      },
    }),
};

export const refreshTool: McpTool = {
  name: 'refresh',
  description:
    'Re-read graph files from disk. Use after running `code-wiki build` or pulling the federation repo.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) => {
    reader.refresh();
    return buildResponse(reader, {
      data: {
        refreshed: true,
        service_count: reader.services().length,
        edge_count: reader.edges().length,
      },
    });
  },
};

export const healthTool: McpTool = {
  name: 'health',
  description:
    'Report schema version, graph freshness, and any services whose local repo paths are missing.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) => {
    const missing: string[] = [];
    for (const svc of reader.services()) {
      if (!existsSync(svc.repo)) missing.push(svc.id);
    }
    return buildResponse(reader, {
      data: {
        schema_version: '2.0',
        graph_freshness_seconds: reader.freshnessSeconds(),
        service_count: reader.services().length,
        edge_count: reader.edges().length,
        missing_repo_paths: missing,
      },
    });
  },
};

ALL_TOOLS.push(statsTool, refreshTool, healthTool);
