import { describe, it, expect } from 'vitest';
import { KafkaAdapter } from '../../src/adapters/communication/kafka.js';
import type { CommunicationDetection } from '../../src/adapters/types.js';
import path from 'node:path';

const KAFKA_REPO = path.join(
  import.meta.dirname, '..', 'fixtures', 'repos', 'kafka-producer'
);

describe('KafkaAdapter', () => {
  const adapter = new KafkaAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('kafka');
    expect(adapter.type).toBe('communication');
  });

  it('detects Kafka topics from Spring config', async () => {
    const result =
      (await adapter.detect(KAFKA_REPO)) as CommunicationDetection;
    expect(result.detected).toBe(true);
    expect(result.details.type).toBe('kafka');
    expect(result.details.identifiers).toContain('credit.check.requests');
    expect(result.details.identifiers).toContain('credit.check.responses');
    expect(result.details.identifiers).toContain('credit.check.dlq');
  });

  it('detects producer role', async () => {
    const result =
      (await adapter.detect(KAFKA_REPO)) as CommunicationDetection;
    expect(result.details.role).toBe('both');
  });

  it('identifies config files', async () => {
    const result =
      (await adapter.detect(KAFKA_REPO)) as CommunicationDetection;
    expect(result.details.config_files.length).toBeGreaterThan(0);
    expect(result.details.config_files[0]).toContain('application.yaml');
  });

  it('detects kafkajs in TS repo', async () => {
    const tsRepo = path.join(
      import.meta.dirname, '..', 'fixtures', 'repos', 'ts-service'
    );
    const result = await adapter.detect(tsRepo);
    expect(result.detected).toBe(true);
  });
});
