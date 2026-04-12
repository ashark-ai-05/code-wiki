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

ALL_TOOLS.push(listServicesTool, getServiceTool, findByTechTool);
