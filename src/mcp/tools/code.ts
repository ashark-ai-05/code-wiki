import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import glob from 'fast-glob';
import type { McpTool } from './index.js';
import { buildResponse } from '../response.js';

const MAX_BYTES_PER_READ = 512 * 1024;
const MAX_SEARCH_MATCHES = 200;

function resolveRepoRoot(
  reader: import('../graph-reader.js').GraphReader,
  serviceId: string
): { ok: true; root: string } | { ok: false; error: string } {
  const svc = reader.getServiceById(serviceId);
  if (!svc) {
    return { ok: false, error: `Service "${serviceId}" not found in graph.` };
  }
  if (!existsSync(svc.repo)) {
    return {
      ok: false,
      error: `Repo path does not exist locally: ${svc.repo}. Clone the repo or set up CODE_WIKI_REPO_ROOT.`,
    };
  }
  return { ok: true, root: svc.repo };
}

function safeJoin(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

export const listFilesTool: McpTool = {
  name: 'list_files',
  description:
    'List files in a service\'s repository. Optional glob filter (e.g., "**/*.ts").',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      glob: { type: 'string', default: '**/*' },
    },
    required: ['service_id'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    const pattern = (args.glob as string) ?? '**/*';
    const files = await glob([pattern], {
      cwd: r.root,
      ignore: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/.git/**',
        '**/build/**',
        '**/target/**',
        '**/dist/**',
      ],
    });
    return buildResponse(reader, {
      data: { service_id: args.service_id, files: files.sort() },
      confidence: 'static',
    });
  },
};

export const readFileTool: McpTool = {
  name: 'read_file',
  description:
    'Read the contents of a file in a service\'s repository. Optional start_line / end_line (1-indexed, inclusive).',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      path: { type: 'string', description: 'Path relative to repo root' },
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
    },
    required: ['service_id', 'path'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    const abs = safeJoin(r.root, args.path as string);
    if (!abs) {
      return buildResponse(reader, {
        data: { error: 'Refusing to read path outside the repo root.' },
      });
    }
    if (!existsSync(abs)) {
      return buildResponse(reader, {
        data: { error: `File not found: ${args.path}` },
      });
    }

    let content = readFileSync(abs, 'utf-8');
    if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES_PER_READ) {
      content = content.slice(0, MAX_BYTES_PER_READ);
    }

    const startLine = args.start_line as number | undefined;
    const endLine = args.end_line as number | undefined;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const s = (startLine ?? 1) - 1;
      const e = endLine ?? lines.length;
      content = lines.slice(s, e).join('\n');
    }

    return buildResponse(reader, {
      data: {
        service_id: args.service_id,
        path: args.path,
        content,
      },
      evidence: [
        {
          kind: 'file',
          service_id: args.service_id as string,
          path: args.path as string,
          line: startLine,
        },
      ],
      confidence: 'static',
    });
  },
};

export const searchFilesTool: McpTool = {
  name: 'search_files',
  description:
    'Search for a regex pattern in a service\'s files. Returns up to 200 file:line matches. Optional glob to restrict search paths.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      pattern: { type: 'string', description: 'Regex pattern (JavaScript flavor)' },
      glob: { type: 'string', default: '**/*' },
    },
    required: ['service_id', 'pattern'],
    additionalProperties: false,
  },
  handler: async (args, { reader }) => {
    const r = resolveRepoRoot(reader, args.service_id as string);
    if (!r.ok) return buildResponse(reader, { data: { error: r.error } });

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern as string);
    } catch (err) {
      return buildResponse(reader, {
        data: { error: `Invalid regex: ${(err as Error).message}` },
      });
    }

    const pattern = (args.glob as string) ?? '**/*';
    const files = await glob([pattern], {
      cwd: r.root,
      ignore: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/.git/**',
        '**/build/**',
        '**/target/**',
        '**/dist/**',
      ],
    });

    const matches: Array<{ path: string; line: number; text: string }> = [];
    outer: for (const rel of files) {
      const abs = path.join(r.root, rel);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ path: rel, line: i + 1, text: lines[i] });
          if (matches.length >= MAX_SEARCH_MATCHES) break outer;
        }
      }
    }

    return buildResponse(reader, {
      data: {
        service_id: args.service_id,
        pattern: args.pattern,
        matches,
        truncated: matches.length >= MAX_SEARCH_MATCHES,
      },
      confidence: 'static',
    });
  },
};

