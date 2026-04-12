import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Graph } from '../graph/types.js';
import {
  wikiIndex,
  serviceOverview,
  serviceTechStack,
  serviceDependencies,
  serviceApi,
  serviceGlossary,
  serviceRunbook,
  serviceWorkflows,
} from './templates.js';

export function generateWiki(
  graph: Graph,
  outputDir: string
): void {
  writeFileSync(
    path.join(outputDir, 'index.md'),
    wikiIndex(graph.services, graph.edges),
    'utf-8'
  );

  for (const service of graph.services) {
    const serviceDir = path.join(
      outputDir, 'services', service.id
    );
    mkdirSync(serviceDir, { recursive: true });

    writeFileSync(
      path.join(serviceDir, 'overview.md'),
      serviceOverview(service, graph.edges),
      'utf-8'
    );

    writeFileSync(
      path.join(serviceDir, 'tech-stack.md'),
      serviceTechStack(service),
      'utf-8'
    );

    writeFileSync(
      path.join(serviceDir, 'dependencies.md'),
      serviceDependencies(service, graph.edges),
      'utf-8'
    );

    writeFileSync(
      path.join(serviceDir, 'api.md'),
      serviceApi(service),
      'utf-8'
    );

    writeFileSync(
      path.join(serviceDir, 'glossary.md'),
      serviceGlossary(service),
      'utf-8'
    );

    const runbookPath = path.join(serviceDir, 'runbook.md');
    if (!existsSync(runbookPath)) {
      writeFileSync(runbookPath, serviceRunbook(service), 'utf-8');
    }

    writeFileSync(
      path.join(serviceDir, 'workflows.md'),
      serviceWorkflows(service),
      'utf-8'
    );
  }
}
