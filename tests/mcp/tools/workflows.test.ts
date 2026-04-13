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

function writeGraph(graphDir: string, withWorkflow: boolean): void {
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(
    path.join(graphDir, 'services.json'),
    JSON.stringify({ schema_version: '2.0', services: [] })
  );
  if (withWorkflow) {
    writeFileSync(
      path.join(graphDir, 'workflows.json'),
      JSON.stringify({
        schema_version: '2.0',
        workflows: [
          {
            name: 'order-placement',
            entry_points: ['svc-a'],
            services: ['svc-a', 'svc-b'],
            edges: ['e001'],
          },
        ],
      })
    );
  }
}

describe('workflow tools', () => {
  let tmp: string;
  let reader: GraphReader;

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('with workflows.json present', () => {
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
      const graphDir = path.join(tmp, 'graph');
      writeGraph(graphDir, true);
      reader = new GraphReader(graphDir);
    });

    it('list_workflows returns declared workflows', async () => {
      const res = await listWorkflowsTool.handler(
        {},
        { reader, cwd: tmp }
      );
      const data = res.data as { workflows: Array<{ name: string }> };
      expect(data.workflows).toHaveLength(1);
      expect(data.workflows[0].name).toBe('order-placement');
    });

    it('get_workflow returns the matching workflow', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'order-placement' },
        { reader, cwd: tmp }
      );
      const data = res.data as {
        workflow: { services: string[] } | null;
      };
      expect(data.workflow).not.toBeNull();
      expect(data.workflow!.services.sort()).toEqual(['svc-a', 'svc-b']);
    });

    it('get_workflow returns null for unknown name', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'does-not-exist' },
        { reader, cwd: tmp }
      );
      const data = res.data as { workflow: null; not_found: true };
      expect(data.workflow).toBeNull();
      expect(data.not_found).toBe(true);
    });
  });

  describe('without workflows.json', () => {
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-wf-'));
      const graphDir = path.join(tmp, 'graph');
      writeGraph(graphDir, false);
      reader = new GraphReader(graphDir);
    });

    it('list_workflows returns empty list (no error)', async () => {
      const res = await listWorkflowsTool.handler(
        {},
        { reader, cwd: tmp }
      );
      const data = res.data as { workflows: unknown[] };
      expect(data.workflows).toEqual([]);
    });

    it('get_workflow returns null', async () => {
      const res = await getWorkflowTool.handler(
        { name: 'anything' },
        { reader, cwd: tmp }
      );
      const data = res.data as { workflow: null };
      expect(data.workflow).toBeNull();
    });
  });
});
