import type { RepoFingerprint, Exposure } from '../fingerprint/types.js';
import { normalizeIdentifier } from '../fingerprint/normalize.js';
import type { Graph, ServiceNode, Edge } from './types.js';

export function buildGraph(fingerprints: RepoFingerprint[]): Graph {
  const services = fingerprints.map(toServiceNode);
  const edges = buildEdges(fingerprints);
  return { schema_version: '2.0', services, edges };
}

function toServiceNode(fp: RepoFingerprint): ServiceNode {
  const languages = fp.tech_stack.languages.map((l) =>
    l.version ? `${l.language}:${l.version}` : l.language
  );

  const frameworks: string[] = [];
  const buildTools: string[] = [];

  for (const lang of fp.tech_stack.languages) {
    if (lang.build_tool) buildTools.push(lang.build_tool);
    for (const dep of lang.dependencies ?? []) {
      if (dep.scope === 'test' || dep.scope === 'dev') continue;
      if (dep.name.includes('spring-boot')) frameworks.push('spring-boot');
      if (dep.name === 'express') frameworks.push('express');
      if (dep.name === 'fastify') frameworks.push('fastify');
      if (dep.name === 'react') frameworks.push('react');
      if (dep.name === 'next') frameworks.push('next');
    }
  }

  return {
    id: fp.repo.name,
    repo: fp.repo.path,
    type: 'microservice',
    tech_stack: {
      languages: [...new Set(languages)],
      frameworks: [...new Set(frameworks)],
      build: [...new Set(buildTools)],
      runtime: [],
      databases: [],
    },
    exposes: fp.exposes,
    consumes: fp.consumes,
    last_scanned: fp.scanned_at,
    scan_sha: fp.repo.sha,
  };
}

interface Endpoint {
  service: string;
  exposure: Exposure;
}

function buildEdges(fingerprints: RepoFingerprint[]): Edge[] {
  const edges: Edge[] = [];
  let edgeId = 0;

  const producers = new Map<string, Endpoint[]>();
  const consumers = new Map<string, Endpoint[]>();

  for (const fp of fingerprints) {
    for (const ex of fp.exposes) {
      if (ex.identifier === '<unknown>') continue;
      const key = edgeKey(ex);
      const list = producers.get(key) ?? [];
      list.push({ service: fp.repo.name, exposure: ex });
      producers.set(key, list);
    }
    for (const ex of fp.consumes) {
      if (ex.identifier === '<unknown>') continue;
      const key = edgeKey(ex);
      const list = consumers.get(key) ?? [];
      list.push({ service: fp.repo.name, exposure: ex });
      consumers.set(key, list);
    }
  }

  for (const [key, prodList] of producers.entries()) {
    const consList = consumers.get(key) ?? [];
    for (const producer of prodList) {
      for (const consumer of consList) {
        if (producer.service === consumer.service) continue;
        edgeId++;
        edges.push({
          id: `e${String(edgeId).padStart(3, '0')}`,
          from: producer.service,
          to: consumer.service,
          type: edgeType(producer.exposure.type),
          bidirectional: false,
          details: detailsFor(producer.exposure),
          evidence: {
            from_file: producer.exposure.source.path,
            from_line: producer.exposure.source.line,
            to_file: consumer.exposure.source.path,
            to_line: consumer.exposure.source.line,
          },
          confidence:
            producer.exposure.confidence === 'static' &&
            consumer.exposure.confidence === 'static'
              ? 'static'
              : 'inferred',
          discovered_at: new Date().toISOString(),
          workflows: [],
        });
      }
    }
  }

  return edges;
}

function edgeKey(ex: Exposure): string {
  return `${ex.type}::${normalizeIdentifier(ex.type, ex.identifier)}`;
}

function edgeType(exposureType: Exposure['type']): string {
  if (exposureType === 'kafka-topic') return 'kafka';
  if (exposureType === 'rest-endpoint') return 'rest';
  if (exposureType === 'grpc-service') return 'grpc';
  return exposureType;
}

function detailsFor(ex: Exposure): Record<string, unknown> {
  if (ex.type === 'kafka-topic') return { topic: ex.identifier };
  if (ex.type === 'rest-endpoint') return { endpoint: ex.identifier };
  return { identifier: ex.identifier };
}
