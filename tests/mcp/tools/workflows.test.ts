import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listWorkflowsTool,
  getWorkflowTool,
} from '../../../src/mcp/tools/workflows.js';
import { GraphReader } from '../../../src/mcp/graph-reader.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('workflow tools', () => {
  let tmp: string;
  let reader: GraphReader;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
    const graphDir = path.join(tmp, 'graph');
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      path.join(graphDir, 'services.json'),
      JSON.stringify({ schema_version: '2.0', services: [] })
    );
    reader = new GraphReader(graphDir);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('list_workflows returns empty list with a note', async () => {
    const res = await listWorkflowsTool.handler(
      {},
      { reader, cwd: tmp }
    );
    const data = res.data as { workflows: unknown[]; note: string };
    expect(data.workflows).toEqual([]);
    expect(data.note.toLowerCase()).toContain('federation');
  });

  it('get_workflow returns not_found with a note', async () => {
    const res = await getWorkflowTool.handler(
      { name: 'order-placement' },
      { reader, cwd: tmp }
    );
    const data = res.data as {
      workflow: null;
      not_found: true;
      note: string;
    };
    expect(data.workflow).toBeNull();
    expect(data.not_found).toBe(true);
    expect(data.note.toLowerCase()).toContain('federation');
  });
});
