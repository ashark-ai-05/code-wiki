import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface Rpc {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

async function sendAndReceive(
  proc: ChildProcessWithoutNullStreams,
  msg: Rpc,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const newlineIdx = buf.indexOf('\n');
      if (newlineIdx >= 0) {
        const line = buf.slice(0, newlineIdx);
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === msg.id) {
            proc.stdout.off('data', onData);
            resolve(parsed);
          }
        } catch {
          /* keep buffering */
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error('timeout waiting for response'));
    }, timeoutMs);
  });
}

describe('MCP server integration', () => {
  let tmp: string;
  let proc: ChildProcessWithoutNullStreams;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-mcp-it-'));
    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({
        schema_version: '2.0',
        services: [
          {
            id: 'svc-a',
            repo: tmp,
            type: 'microservice',
            tech_stack: {
              languages: ['go:1.22'],
              frameworks: [],
              build: ['go'],
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
    writeFileSync(
      path.join(graphDir, 'edges.json'),
      JSON.stringify({ schema_version: '2.0', edges: [] })
    );
    writeFileSync(
      path.join(graphDir, 'tech-matrix.json'),
      JSON.stringify({
        languages: { 'go:1.22': ['svc-a'] },
        frameworks: {},
        build: { go: ['svc-a'] },
      })
    );

    proc = spawn(
      'npx',
      ['tsx', 'bin/code-wiki.ts', 'mcp'],
      {
        cwd: process.cwd(),
        env: { ...process.env, CODE_WIKI_GRAPH: graphDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ) as ChildProcessWithoutNullStreams;
  });

  afterEach(() => {
    proc.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('responds to tools/list with the full catalog', async () => {
    const initResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
    expect(initResp.result).toBeDefined();

    const listResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const tools = (
      listResp.result as { tools: Array<{ name: string }> }
    ).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_services');
    expect(names).toContain('get_service');
    expect(names).toContain('stats');
    expect(names.length).toBe(14);
  });

  it('responds to tools/call list_services with the service', async () => {
    await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const callResp = await sendAndReceive(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_services', arguments: {} },
    });
    const result = callResp.result as {
      content: Array<{ type: 'text'; text: string }>;
    };
    const payload = JSON.parse(result.content[0].text);
    expect(payload.data.services).toHaveLength(1);
    expect(payload.data.services[0].id).toBe('svc-a');
    expect(payload.sources.graph_path).toContain('graph');
  });
}, 20000);
