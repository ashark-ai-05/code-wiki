import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  fingerprintRepo,
} from '../../src/scanner/fingerprint.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import path from 'node:path';

const FIXTURES = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos'
);

describe('fingerprintRepo', () => {
  it('produces v2.0 schema with repo.name and repo.path', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(result.schema_version).toBe('2.0');
    expect(result.repo.name).toBe('java-service');
    expect(result.repo.path).toContain('java-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'java' })
    );
  });

  it('splits kafka-topic exposures by role into exposes/consumes', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'kafka-producer'),
      registry
    );
    const exposedTopics = result.exposes
      .filter((e) => e.type === 'kafka-topic')
      .map((e) => e.identifier);
    const consumedTopics = result.consumes
      .filter((e) => e.type === 'kafka-topic')
      .map((e) => e.identifier);

    // The kafka-producer fixture has both producer and consumer blocks,
    // so `both`-role topics appear in BOTH arrays.
    expect(exposedTopics).toContain('credit.check.requests');
    expect(consumedTopics).toContain('credit.check.requests');
  });

  it('puts REST endpoints into exposes for a Go chi service', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'go-rest-service'),
      registry
    );
    const restIds = result.exposes
      .filter((e) => e.type === 'rest-endpoint')
      .map((e) => e.identifier);
    expect(restIds).toContain('POST /orders');
    expect(restIds).toContain('GET /orders/{id}');
  });

  it('fingerprints a TypeScript service repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const result = await fingerprintRepo(
      path.join(FIXTURES, 'ts-service'),
      registry
    );
    expect(result.repo.name).toBe('ts-service');
    expect(result.tech_stack.languages).toContainEqual(
      expect.objectContaining({ language: 'typescript' })
    );
  });
});

describe('fingerprint (batch)', () => {
  it('scans multiple repos in a directory', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(FIXTURES, registry);
    const names = results.map((r) => r.repo.name);
    expect(names).toContain('java-service');
    expect(names).toContain('ts-service');
    expect(names).toContain('kafka-producer');
    expect(names).toContain('go-rest-service');
  });

  it('treats a single-repo path as one repo', async () => {
    const registry = AdapterRegistry.withBuiltins();
    const results = await fingerprint(
      path.join(FIXTURES, 'java-service'),
      registry
    );
    expect(results).toHaveLength(1);
    expect(results[0].repo.name).toBe('java-service');
  });
});
