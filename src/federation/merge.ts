import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { RepoFingerprint } from '../fingerprint/types.js';
import { isValidFingerprint } from '../fingerprint/schema.js';
import { buildGraph } from '../graph/builder.js';
import { writeGraph } from '../graph/writer.js';
import { resolveWorkflows } from './workflows.js';

export interface MergeOptions {
  fingerprintsDir: string;
  graphDir: string;
}

export interface MergeResult {
  changed: boolean;
  merged: string[];
  skipped: string[];
}

export function mergeFederation(opts: MergeOptions): MergeResult {
  const fingerprints: RepoFingerprint[] = [];
  const merged: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(opts.fingerprintsDir)) {
    throw new Error(
      `Fingerprints directory does not exist: ${opts.fingerprintsDir}`
    );
  }

  const files = readdirSync(opts.fingerprintsDir).filter((f) =>
    f.endsWith('.json')
  );
  for (const file of files) {
    const fullPath = path.join(opts.fingerprintsDir, file);
    try {
      const parsed = JSON.parse(readFileSync(fullPath, 'utf-8'));
      if (!isValidFingerprint(parsed)) {
        skipped.push(file);
        continue;
      }
      fingerprints.push(parsed);
      merged.push(file);
    } catch {
      skipped.push(file);
    }
  }

  const graph = buildGraph(fingerprints);
  const workflows = resolveWorkflows(fingerprints, graph.edges);

  const outputParent = path.dirname(opts.graphDir);
  mkdirSync(outputParent, { recursive: true });

  const newWorkflowsJson = JSON.stringify(
    { schema_version: '2.0', workflows },
    null,
    2
  );
  const workflowsPath = path.join(opts.graphDir, 'workflows.json');

  const servicesPath = path.join(opts.graphDir, 'services.json');
  const edgesPath = path.join(opts.graphDir, 'edges.json');
  const newServicesJson = JSON.stringify(
    { schema_version: graph.schema_version, services: graph.services },
    null,
    2
  );
  const newEdgesJson = JSON.stringify(
    { schema_version: graph.schema_version, edges: graph.edges },
    null,
    2
  );

  const prevServices = existsSync(servicesPath)
    ? readFileSync(servicesPath, 'utf-8')
    : '';
  const prevEdges = existsSync(edgesPath)
    ? readFileSync(edgesPath, 'utf-8')
    : '';
  const prevWorkflows = existsSync(workflowsPath)
    ? readFileSync(workflowsPath, 'utf-8')
    : '';

  const changed =
    prevServices !== newServicesJson ||
    prevEdges !== newEdgesJson ||
    prevWorkflows !== newWorkflowsJson;

  if (changed) {
    writeGraph(graph, outputParent);
    writeFileSync(workflowsPath, newWorkflowsJson, 'utf-8');
  }

  return { changed, merged, skipped };
}
