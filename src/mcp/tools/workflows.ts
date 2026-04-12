import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

const FEDERATION_NOTE =
  'Workflow data is populated by the federation merge job (slice 2d). In single-repo mode, no workflows are available yet.';

export const listWorkflowsTool: McpTool = {
  name: 'list_workflows',
  description:
    'List named workflows across the graph. In single-repo mode without federation, this returns an empty list with a note.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: { workflows: [], note: FEDERATION_NOTE },
      confidence: 'static',
    }),
};

export const getWorkflowTool: McpTool = {
  name: 'get_workflow',
  description:
    'Get the service list + edges that make up a named workflow. Returns null + a note in single-repo mode.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (_args, { reader }) =>
    buildResponse(reader, {
      data: { workflow: null, not_found: true, note: FEDERATION_NOTE },
      confidence: 'static',
    }),
};

ALL_TOOLS.push(listWorkflowsTool, getWorkflowTool);
