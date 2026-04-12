import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  fingerprintRepo,
} from '../../src/scanner/fingerprint.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import path from 'node:path';

const FIXTURES = path.join(
  import.meta.dirname, '..', 'fixtures', 'repos'
);

describe('fingerprintRepo', () => {
  it('fingerprints a Java service repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(result.repo_path).toContain('java-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'java' })
    );
    expect(result.communication.length).toBeGreaterThan(0);
  });

  it('fingerprints a TypeScript service repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'ts-service'),
      registry
    );
    expect(result.repo_path).toContain('ts-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'typescript' })
    );
  });

  it('detects Kafka in kafka-producer fixture', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'kafka-producer'),
      registry
    );
    const kafkaComm = result.communication.find(
      (c) => c.type === 'kafka'
    );
    expect(kafkaComm).toBeDefined();
    expect(kafkaComm!.identifiers).toContain(
      'credit.check.requests'
    );
  });
});

describe('fingerprint (batch)', () => {
  it('scans multiple repos in a directory', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(FIXTURES, registry);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const names = results.map((r) => path.basename(r.repo_path));
    expect(names).toContain('java-service');
    expect(names).toContain('ts-service');
    expect(names).toContain('kafka-producer');
  });

  it('treats a single-repo path as one repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(results).toHaveLength(1);
    expect(path.basename(results[0].repo_path)).toBe('java-service');
    expect(results[0].tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'java' })
    );
  });
});
