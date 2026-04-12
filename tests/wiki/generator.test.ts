import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateWiki } from '../../src/wiki/generator.js';
import type { Graph } from '../../src/graph/types.js';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('generateWiki', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(
      path.join(os.tmpdir(), 'code-wiki-test-')
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const testGraph: Graph = {
    schema_version: '1.0',
    services: [
      {
        id: 'credit-gateway',
        repo: '/repos/credit-gateway',
        type: 'microservice',
        tech_stack: {
          languages: ['java:17'],
          frameworks: ['spring-boot'],
          build: ['gradle'],
          runtime: [],
          databases: [],
        },
        exposes: ['kafka-producer'],
        consumes: ['kafka-consumer'],
        last_scanned: '2026-04-12T10:00:00Z',
      },
      {
        id: 'risk-calc',
        repo: '/repos/risk-calc',
        type: 'microservice',
        tech_stack: {
          languages: ['java:17'],
          frameworks: ['spring-boot'],
          build: ['gradle'],
          runtime: [],
          databases: [],
        },
        exposes: [],
        consumes: ['kafka-consumer'],
        last_scanned: '2026-04-12T10:00:00Z',
      },
    ],
    edges: [
      {
        id: 'e001',
        from: 'credit-gateway',
        to: 'risk-calc',
        type: 'kafka',
        bidirectional: false,
        details: { topic: 'credit.check.requests' },
        evidence: {},
        confidence: 'static',
        discovered_at: '2026-04-12T10:00:00Z',
        workflows: [],
      },
    ],
  };

  it('creates index.md at wiki root', () => {
    generateWiki(testGraph, tmpDir);
    const indexPath = path.join(tmpDir, 'index.md');
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, 'utf-8');
    expect(content).toContain('credit-gateway');
    expect(content).toContain('risk-calc');
  });

  it('creates service overview.md for each service', () => {
    generateWiki(testGraph, tmpDir);
    const overviewPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'overview.md'
    );
    expect(existsSync(overviewPath)).toBe(true);
    const content = readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('credit-gateway');
    expect(content).toContain('java:17');
    expect(content).toContain('generated_by: code-wiki');
  });

  it('creates tech-stack.md for each service', () => {
    generateWiki(testGraph, tmpDir);
    const techPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'tech-stack.md'
    );
    expect(existsSync(techPath)).toBe(true);
    const content = readFileSync(techPath, 'utf-8');
    expect(content).toContain('spring-boot');
    expect(content).toContain('gradle');
  });

  it('creates dependencies.md with edge info', () => {
    generateWiki(testGraph, tmpDir);
    const depsPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'dependencies.md'
    );
    expect(existsSync(depsPath)).toBe(true);
    const content = readFileSync(depsPath, 'utf-8');
    expect(content).toContain('risk-calc');
    expect(content).toContain('credit.check.requests');
  });

  it('includes frontmatter in generated pages', () => {
    generateWiki(testGraph, tmpDir);
    const content = readFileSync(
      path.join(
        tmpDir, 'services', 'credit-gateway', 'overview.md'
      ),
      'utf-8'
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('generated_by: code-wiki');
    expect(content).toContain('generated_at:');
    expect(content).toContain('source_repos:');
  });
});
