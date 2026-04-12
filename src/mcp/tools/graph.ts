import type { McpTool } from './index.js';
import { ALL_TOOLS } from './index.js';
import { buildResponse } from '../response.js';

export const listServicesTool: McpTool = {
  name: 'list_services',
  description:
    'List all services in the graph. Optionally filter by language (substring), framework (exact), or build tool (exact).',
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Filter by language substring (e.g., "java")',
      },
      framework: {
        type: 'string',
        description: 'Filter by exact framework name (e.g., "spring-boot")',
      },
      build: {
        type: 'string',
        description: 'Filter by exact build tool name (e.g., "gradle")',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const langFilter = args.language as string | undefined;
    const fwFilter = args.framework as string | undefined;
    const buildFilter = args.build as string | undefined;

    const services = reader.services().filter((s) => {
      if (
        langFilter &&
        !s.tech_stack.languages.some((l) => l.includes(langFilter))
      ) {
        return false;
      }
      if (
        fwFilter &&
        !s.tech_stack.frameworks.includes(fwFilter)
      ) {
        return false;
      }
      if (
        buildFilter &&
        !s.tech_stack.build.includes(buildFilter)
      ) {
        return false;
      }
      return true;
    });

    return buildResponse(reader, {
      data: {
        services: services.map((s) => ({
          id: s.id,
          repo: s.repo,
          languages: s.tech_stack.languages,
          frameworks: s.tech_stack.frameworks,
          build: s.tech_stack.build,
          exposes_count: s.exposes.length,
          consumes_count: s.consumes.length,
        })),
      },
      confidence: 'static',
    });
  },
};

export const getServiceTool: McpTool = {
  name: 'get_service',
  description:
    'Get full details of one service by id, including all exposes and consumes entries with source evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The service id' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const id = args.id as string;
    const service = reader.getServiceById(id) ?? null;
    return buildResponse(reader, {
      data: { service },
      confidence: 'static',
    });
  },
};

export const findByTechTool: McpTool = {
  name: 'find_by_tech',
  description:
    'Find all services using a given technology. Category is one of "languages", "frameworks", or "build"; value is the exact key to look up.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['languages', 'frameworks', 'build'],
      },
      value: {
        type: 'string',
        description:
          'The technology key (e.g., "java:17", "spring-boot", "gradle")',
      },
    },
    required: ['category', 'value'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const category = args.category as 'languages' | 'frameworks' | 'build';
    const value = args.value as string;
    const matrix = reader.techMatrix();
    const services = matrix[category]?.[value] ?? [];
    return buildResponse(reader, {
      data: { category, value, services },
      confidence: 'static',
    });
  },
};

export const traceDownstreamTool: McpTool = {
  name: 'trace_downstream',
  description:
    'Walk outgoing edges from a service. `depth` limits hops (default 1). `edge_types` filters by edge type (e.g., ["kafka"]).',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      edge_types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: restrict to these edge types',
      },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const startId = args.service_id as string;
    const depth = (args.depth as number) ?? 1;
    const edgeTypes = args.edge_types as string[] | undefined;
    const reached = traverse(reader.edges(), startId, depth, edgeTypes, 'out');
    return buildResponse(reader, {
      data: { from: startId, depth, reached },
      confidence: 'static',
    });
  },
};

export const traceUpstreamTool: McpTool = {
  name: 'trace_upstream',
  description:
    'Walk incoming edges to a service. `depth` limits hops (default 1). `edge_types` filters by edge type.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      edge_types: { type: 'array', items: { type: 'string' } },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const startId = args.service_id as string;
    const depth = (args.depth as number) ?? 1;
    const edgeTypes = args.edge_types as string[] | undefined;
    const reached = traverse(reader.edges(), startId, depth, edgeTypes, 'in');
    return buildResponse(reader, {
      data: { to: startId, depth, reached },
      confidence: 'static',
    });
  },
};

export const getEdgesTool: McpTool = {
  name: 'get_edges',
  description:
    'List edges in the graph, optionally filtered by type, from, or to.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Edge type, e.g., "kafka"' },
      from: { type: 'string', description: 'Source service id' },
      to: { type: 'string', description: 'Target service id' },
    },
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const typeFilter = args.type as string | undefined;
    const fromFilter = args.from as string | undefined;
    const toFilter = args.to as string | undefined;

    const edges = reader.edges().filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (fromFilter && e.from !== fromFilter) return false;
      if (toFilter && e.to !== toFilter) return false;
      return true;
    });

    return buildResponse(reader, {
      data: { edges },
      confidence: 'static',
    });
  },
};

function traverse(
  edges: import('../../graph/types.js').Edge[],
  startId: string,
  depth: number,
  edgeTypes: string[] | undefined,
  direction: 'in' | 'out'
): string[] {
  const visited = new Set<string>();
  let frontier = new Set<string>([startId]);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const edge of edges) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (direction === 'out' && edge.from === node) {
          if (!visited.has(edge.to) && edge.to !== startId) {
            next.add(edge.to);
          }
        }
        if (direction === 'in' && edge.to === node) {
          if (!visited.has(edge.from) && edge.from !== startId) {
            next.add(edge.from);
          }
        }
      }
    }
    for (const n of next) visited.add(n);
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [...visited];
}

ALL_TOOLS.push(
  listServicesTool,
  getServiceTool,
  findByTechTool,
  traceDownstreamTool,
  traceUpstreamTool,
  getEdgesTool
);
