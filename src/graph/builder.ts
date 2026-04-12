import type { RepoFingerprint } from '../scanner/types.js';
import type { Graph, ServiceNode, Edge } from './types.js';

export function buildGraph(fingerprints: RepoFingerprint[]): Graph {
  const services = fingerprints.map(toServiceNode);
  const edges = buildEdges(fingerprints);

  return { schema_version: '1.0', services, edges };
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
      if (dep.name.includes('spring-boot'))
        frameworks.push('spring-boot');
      if (dep.name === 'express') frameworks.push('express');
      if (dep.name === 'fastify') frameworks.push('fastify');
      if (dep.name === 'react') frameworks.push('react');
      if (dep.name === 'next') frameworks.push('next');
    }
  }

  const exposes: string[] = [];
  const consumes: string[] = [];

  for (const comm of fp.communication) {
    const label = `${comm.type}-${comm.role}`;
    if (['producer', 'server', 'both'].includes(comm.role)) {
      exposes.push(label);
    }
    if (['consumer', 'client', 'both'].includes(comm.role)) {
      consumes.push(label);
    }
  }

  return {
    id: fp.repo_name,
    repo: fp.repo_path,
    type: 'microservice',
    tech_stack: {
      languages: [...new Set(languages)],
      frameworks: [...new Set(frameworks)],
      build: [...new Set(buildTools)],
      runtime: [],
      databases: [],
    },
    exposes: [...new Set(exposes)],
    consumes: [...new Set(consumes)],
    last_scanned: fp.scanned_at,
  };
}

function buildEdges(fingerprints: RepoFingerprint[]): Edge[] {
  const edges: Edge[] = [];
  let edgeId = 0;

  const topicProducers = new Map<string, string[]>();
  const topicConsumers = new Map<string, string[]>();

  for (const fp of fingerprints) {
    for (const comm of fp.communication) {
      if (comm.type !== 'kafka') continue;
      for (const topic of comm.identifiers) {
        if (['producer', 'both'].includes(comm.role)) {
          const list = topicProducers.get(topic) ?? [];
          list.push(fp.repo_name);
          topicProducers.set(topic, list);
        }
        if (['consumer', 'both'].includes(comm.role)) {
          const list = topicConsumers.get(topic) ?? [];
          list.push(fp.repo_name);
          topicConsumers.set(topic, list);
        }
      }
    }
  }

  for (const [topic, producers] of topicProducers) {
    const consumers = topicConsumers.get(topic) ?? [];
    for (const producer of producers) {
      for (const consumer of consumers) {
        if (producer === consumer) continue;
        edgeId++;
        edges.push({
          id: `e${String(edgeId).padStart(3, '0')}`,
          from: producer,
          to: consumer,
          type: 'kafka',
          bidirectional: false,
          details: { topic },
          evidence: {},
          confidence: 'static',
          discovered_at: new Date().toISOString(),
          workflows: [],
        });
      }
    }
  }

  return edges;
}
