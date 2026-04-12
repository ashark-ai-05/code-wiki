import { describe, it, expect } from 'vitest';
import { KafkaAdapter } from '../../src/adapters/communication/kafka.js';
import type { Exposure } from '../../src/fingerprint/types.js';
import path from 'node:path';

const KAFKA_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'kafka-producer'
);
const TS_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'ts-service'
);
const CONFIGS_DIR = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'configs'
);

describe('KafkaAdapter', () => {
  const adapter = new KafkaAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('kafka');
    expect(adapter.type).toBe('communication');
  });

  it('detect() still reports detected=true for a Kafka repo', async () => {
    const result = await adapter.detect(KAFKA_REPO);
    expect(result.detected).toBe(true);
  });

  it('detect() reports detected=false for a non-Kafka repo', async () => {
    const result = await adapter.detect(CONFIGS_DIR);
    expect(result.detected).toBe(false);
  });

  it('findExposures returns kafka-topic entries with source evidence', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    expect(exposures.length).toBeGreaterThan(0);
    const identifiers = exposures.map((e) => e.identifier);
    expect(identifiers).toContain('credit.check.requests');
    expect(identifiers).toContain('credit.check.responses');
    expect(identifiers).toContain('credit.check.dlq');

    for (const ex of exposures) {
      expect(ex.type).toBe('kafka-topic');
      expect(ex.source.path).toMatch(/application\.yaml$/);
      expect(typeof ex.source.line === 'number' || ex.source.line === undefined).toBe(true);
      expect(['static', 'annotated', 'inferred']).toContain(ex.detection_method);
      expect(['static', 'inferred']).toContain(ex.confidence);
    }
  });

  it('findExposures attaches a line number for topics found via YAML', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    const defaultTopic = exposures.find(
      (e) => e.identifier === 'credit.check.requests'
    );
    expect(defaultTopic).toBeDefined();
    expect(typeof defaultTopic!.source.line).toBe('number');
    expect(defaultTopic!.source.line).toBeGreaterThan(0);
  });

  it('findExposures assigns role producer/consumer/both per topic', async () => {
    const exposures = await adapter.findExposures!(KAFKA_REPO);
    const roles = new Set(exposures.map((e) => e.role));
    expect([...roles].every((r) => ['producer', 'consumer', 'both'].includes(r))).toBe(true);
  });

  it('findExposures handles kafkajs-only TS repo (no YAML, no line)', async () => {
    const exposures: Exposure[] = await adapter.findExposures!(TS_REPO);
    expect(exposures.length).toBeGreaterThan(0);
    for (const ex of exposures) {
      expect(ex.source.path).toBe('package.json');
    }
  });

  it('findExposures returns [] for a non-Kafka repo', async () => {
    const exposures = await adapter.findExposures!(CONFIGS_DIR);
    expect(exposures).toEqual([]);
  });
});
