import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateWiki } from '../../src/wiki/generator.js';
import type { Graph } from '../../src/graph/types.js';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
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
        exposes: [
          {
            type: 'kafka-topic' as const,
            identifier: 'credit.check.requests',
            role: 'producer' as const,
            source: { path: 'app.yaml', line: 5 },
            detection_method: 'static' as const,
            confidence: 'static' as const,
          },
        ],
        consumes: [
          {
            type: 'kafka-topic' as const,
            identifier: 'credit.check.responses',
            role: 'consumer' as const,
            source: { path: 'app.yaml', line: 7 },
            detection_method: 'static' as const,
            confidence: 'static' as const,
          },
        ],
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
        consumes: [
          {
            type: 'kafka-topic' as const,
            identifier: 'credit.check.requests',
            role: 'consumer' as const,
            source: { path: 'app.yaml', line: 3 },
            detection_method: 'static' as const,
            confidence: 'static' as const,
          },
        ],
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

  it('creates api.md listing exposed endpoints/topics', () => {
    generateWiki(testGraph, tmpDir);
    const apiPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'api.md'
    );
    expect(existsSync(apiPath)).toBe(true);
    const content = readFileSync(apiPath, 'utf-8');
    expect(content).toContain('generated_by: code-wiki');
    expect(content).toContain('# credit-gateway — API');
    // credit-gateway exposes credit.check.requests (kafka-topic)
    expect(content).toContain('credit.check.requests');
    expect(content).toMatch(/Kafka Topics/);
  });

  it('creates glossary.md listing every identifier the service touches', () => {
    generateWiki(testGraph, tmpDir);
    const glossaryPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'glossary.md'
    );
    expect(existsSync(glossaryPath)).toBe(true);
    const content = readFileSync(glossaryPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Glossary');
    expect(content).toContain('generated_by: code-wiki');
    // credit-gateway exposes credit.check.requests, consumes credit.check.responses
    expect(content).toContain('credit.check.requests');
    expect(content).toContain('credit.check.responses');
  });

  it('creates runbook.md scaffold with placeholder sections', () => {
    generateWiki(testGraph, tmpDir);
    const runbookPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'runbook.md'
    );
    expect(existsSync(runbookPath)).toBe(true);
    const content = readFileSync(runbookPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Runbook');
    expect(content).toContain('generated_by: code-wiki');
    expect(content).toContain('## On-call');
    expect(content).toContain('## Dashboards');
    expect(content).toContain('## Common incidents');
    expect(content.toLowerCase()).toContain('fill in');
  });

  it('does not overwrite an existing runbook.md', () => {
    generateWiki(testGraph, tmpDir);
    const runbookPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'runbook.md'
    );
    const customContent = '# my custom runbook\n\nownership: team-foo\n';
    writeFileSync(runbookPath, customContent, 'utf-8');

    generateWiki(testGraph, tmpDir);

    expect(readFileSync(runbookPath, 'utf-8')).toBe(customContent);
  });

  it('creates workflows.md (placeholder when no workflows declared)', () => {
    generateWiki(testGraph, tmpDir);
    const workflowsPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'workflows.md'
    );
    expect(existsSync(workflowsPath)).toBe(true);
    const content = readFileSync(workflowsPath, 'utf-8');
    expect(content).toContain('# credit-gateway — Workflows');
    expect(content).toContain('generated_by: code-wiki');
    expect(content.toLowerCase()).toMatch(
      /no workflows|federation not enabled/
    );
  });

  it('overview.md includes empty narration markers', () => {
    generateWiki(testGraph, tmpDir);
    const overviewPath = path.join(
      tmpDir, 'services', 'credit-gateway', 'overview.md'
    );
    const content = readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('<!-- narrated:start');
    expect(content).toContain('<!-- narrated:end -->');
    expect(content).toContain('narrated_at=""');
    // Structural content still present
    expect(content).toContain('## Tech Stack');
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
