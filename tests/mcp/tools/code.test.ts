import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
} from '../../../src/mcp/tools/code.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('code tools', () => {
  let tmp: string;
  let reader: GraphReader;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-code-'));
    repoRoot = path.join(tmp, 'repos', 'svc-a');
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'src', 'main.ts'),
      'line 1\nline 2 WIDGET\nline 3\n'
    );
    writeFileSync(path.join(repoRoot, 'README.md'), '# svc-a\n');

    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({
        schema_version: '2.0',
        services: [
          {
            id: 'svc-a',
            repo: repoRoot,
            type: 'microservice',
            tech_stack: {
              languages: [],
              frameworks: [],
              build: [],
              runtime: [],
              databases: [],
            },
            exposes: [],
            consumes: [],
            last_scanned: '2026-04-12T10:00:00Z',
          },
        ],
      })
    );
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('list_files returns files in a service repo', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'svc-a' },
      { reader, cwd: tmp }
    );
    const data = res.data as { files: string[] };
    expect(data.files).toContain('README.md');
    expect(data.files).toContain('src/main.ts');
  });

  it('list_files filters by glob', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'svc-a', glob: '**/*.ts' },
      { reader, cwd: tmp }
    );
    const data = res.data as { files: string[] };
    expect(data.files).toEqual(['src/main.ts']);
  });

  it('list_files returns error when service not in graph', async () => {
    const res = await listFilesTool.handler(
      { service_id: 'nope' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('not found');
  });

  it('list_files returns error when repo path does not exist', async () => {
    rmSync(repoRoot, { recursive: true, force: true });
    const res = await listFilesTool.handler(
      { service_id: 'svc-a' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('clone');
  });

  it('read_file returns file contents', async () => {
    const res = await readFileTool.handler(
      { service_id: 'svc-a', path: 'src/main.ts' },
      { reader, cwd: tmp }
    );
    const data = res.data as { content: string };
    expect(data.content).toContain('WIDGET');
  });

  it('read_file supports line range', async () => {
    const res = await readFileTool.handler(
      {
        service_id: 'svc-a',
        path: 'src/main.ts',
        start_line: 2,
        end_line: 2,
      },
      { reader, cwd: tmp }
    );
    const data = res.data as { content: string };
    expect(data.content).toBe('line 2 WIDGET');
  });

  it('read_file refuses paths that escape the repo root', async () => {
    const res = await readFileTool.handler(
      { service_id: 'svc-a', path: '../../etc/passwd' },
      { reader, cwd: tmp }
    );
    const data = res.data as { error: string };
    expect(data.error.toLowerCase()).toContain('outside');
  });

  it('search_files returns matching file:line pairs', async () => {
    const res = await searchFilesTool.handler(
      { service_id: 'svc-a', pattern: 'WIDGET' },
      { reader, cwd: tmp }
    );
    const data = res.data as {
      matches: Array<{ path: string; line: number; text: string }>;
    };
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].path).toBe('src/main.ts');
    expect(data.matches[0].line).toBe(2);
    expect(data.matches[0].text).toContain('WIDGET');
  });
});
