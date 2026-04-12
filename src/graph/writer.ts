import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Graph } from './types.js';

export function writeGraph(graph: Graph, outputDir: string): void {
  const graphDir = path.join(outputDir, 'graph');
  mkdirSync(graphDir, { recursive: true });

  writeFileSync(
    path.join(graphDir, 'services.json'),
    JSON.stringify(
      {
        schema_version: graph.schema_version,
        services: graph.services,
      },
      null,
      2
    ),
    'utf-8'
  );

  writeFileSync(
    path.join(graphDir, 'edges.json'),
    JSON.stringify(
      {
        schema_version: graph.schema_version,
        edges: graph.edges,
      },
      null,
      2
    ),
    'utf-8'
  );

  const matrix = buildTechMatrix(graph);
  writeFileSync(
    path.join(graphDir, 'tech-matrix.json'),
    JSON.stringify(matrix, null, 2),
    'utf-8'
  );

  writeFileSync(
    path.join(graphDir, 'schema-version.json'),
    JSON.stringify(
      {
        version: graph.schema_version,
        updated_at: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );
}

interface TechMatrix {
  languages: Record<string, string[]>;
  frameworks: Record<string, string[]>;
  build: Record<string, string[]>;
}

function buildTechMatrix(graph: Graph): TechMatrix {
  const matrix: TechMatrix = {
    languages: {},
    frameworks: {},
    build: {},
  };

  for (const svc of graph.services) {
    for (const lang of svc.tech_stack.languages) {
      (matrix.languages[lang] ??= []).push(svc.id);
    }
    for (const fw of svc.tech_stack.frameworks) {
      (matrix.frameworks[fw] ??= []).push(svc.id);
    }
    for (const bt of svc.tech_stack.build) {
      (matrix.build[bt] ??= []).push(svc.id);
    }
  }

  return matrix;
}
