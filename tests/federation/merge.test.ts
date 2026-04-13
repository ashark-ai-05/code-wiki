import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeFederation } from '../../src/federation/merge.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function writeFp(dir: string, fp: RepoFingerprint): void {
  writeFileSync(
    path.join(dir, `${fp.repo.name}.json`),
    JSON.stringify(fp)
  );
}

function producer(name: string, topic: string): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'go', version: '1.22', build_tool: 'go' }],
    },
    exposes: [
      {
        type: 'kafka-topic',
        identifier: topic,
        role: 'producer',
        source: { path: 'main.go', line: 1 },
        detection_method: 'static',
        confidence: 'static',
      },
    ],
    consumes: [],
    workflows_declared: [{ name: 'flow', entry_point: true }],
  };
}

function consumer(name: string, topic: string): RepoFingerprint {
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'java', version: '17', build_tool: 'gradle' }],
    },
    exposes: [],
    consumes: [
      {
        type: 'kafka-topic',
        identifier: topic,
        role: 'consumer',
        source: { path: 'App.java', line: 1 },
        detection_method: 'static',
        confidence: 'static',
      },
    ],
  };
}

describe('mergeFederation', () => {
  let tmp: string;
  let fingerprintsDir: string;
  let graphDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-merge-'));
    fingerprintsDir = path.join(tmp, 'fingerprints');
    graphDir = path.join(tmp, 'graph');
    mkdirSync(fingerprintsDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('produces services.json with all fingerprinted services', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    const result = mergeFederation({ fingerprintsDir, graphDir });
    expect(result.changed).toBe(true);
    expect(existsSync(path.join(graphDir, 'services.json'))).toBe(true);
    const services = JSON.parse(
      readFileSync(path.join(graphDir, 'services.json'), 'utf-8')
    );
    expect(services.services).toHaveLength(2);
  });

  it('produces edges.json with cross-repo edge', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    mergeFederation({ fingerprintsDir, graphDir });
    const edges = JSON.parse(
      readFileSync(path.join(graphDir, 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
    expect(edges.edges[0].from).toBe('svc-a');
    expect(edges.edges[0].to).toBe('svc-b');
  });

  it('produces workflows.json from declared entry points', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFp(fingerprintsDir, consumer('svc-b', 'orders.new'));

    mergeFederation({ fingerprintsDir, graphDir });
    const wf = JSON.parse(
      readFileSync(path.join(graphDir, 'workflows.json'), 'utf-8')
    );
    expect(wf.workflows).toHaveLength(1);
    expect(wf.workflows[0].name).toBe('flow');
    expect(wf.workflows[0].services.sort()).toEqual(['svc-a', 'svc-b']);
  });

  it('is idempotent: second run with same inputs reports changed=false', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    mergeFederation({ fingerprintsDir, graphDir });
    const second = mergeFederation({ fingerprintsDir, graphDir });
    expect(second.changed).toBe(false);
  });

  it('skips invalid fingerprints but keeps going', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'orders.new'));
    writeFileSync(
      path.join(fingerprintsDir, 'bad.json'),
      '{"schema_version":"1.0"}'
    );
    const result = mergeFederation({ fingerprintsDir, graphDir });
    expect(result.skipped).toContain('bad.json');
    const services = JSON.parse(
      readFileSync(path.join(graphDir, 'services.json'), 'utf-8')
    );
    expect(services.services).toHaveLength(1);
  });

  it('normalizes identifiers so env-prefixed topics still match', () => {
    writeFp(fingerprintsDir, producer('svc-a', 'prod.orders.new.v1'));
    writeFp(fingerprintsDir, consumer('svc-b', 'dev.orders.new.v2'));

    mergeFederation({ fingerprintsDir, graphDir });
    const edges = JSON.parse(
      readFileSync(path.join(graphDir, 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
  });
});
