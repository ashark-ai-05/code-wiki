import type { McpTool } from './index.js';
import { buildResponse } from '../response.js';

export const listWorkflowsTool: McpTool = {
  name: 'list_workflows',
  description:
    'List named workflows across the graph. Each workflow has entry points, member services, and the edges that form it.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: {
        workflows: reader.workflows().map((w) => ({
          name: w.name,
          entry_points: w.entry_points,
          service_count: w.services.length,
          edge_count: w.edges.length,
        })),
      },
      confidence: 'static',
    }),
};

export const getWorkflowTool: McpTool = {
  name: 'get_workflow',
  description:
    'Get the full service list + edge ids for a named workflow.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const name = args.name as string;
    const workflow = reader.workflows().find((w) => w.name === name);
    if (!workflow) {
      return buildResponse(reader, {
        data: { workflow: null, not_found: true },
        confidence: 'static',
      });
    }
    return buildResponse(reader, {
      data: { workflow },
      confidence: 'static',
    });
  },
};
