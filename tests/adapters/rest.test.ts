import { describe, it, expect } from 'vitest';
import { RestAdapter } from '../../src/adapters/communication/rest.js';
import path from 'node:path';

const GO_REST_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'go-rest-service'
);
const JAVA_REPO = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'repos',
  'java-service'
);

describe('RestAdapter', () => {
  const adapter = new RestAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('rest');
    expect(adapter.type).toBe('communication');
  });

  it('detects chi routes in a Go repo', async () => {
    const exposures = await adapter.findExposures!(GO_REST_REPO);
    const identifiers = exposures.map((e) => e.identifier).sort();
    expect(identifiers).toContain('GET /health');
    expect(identifiers).toContain('POST /orders');
    expect(identifiers).toContain('GET /orders/{id}');
    expect(identifiers).toContain('PUT /orders/{id}');
    expect(identifiers).toContain('DELETE /orders/{id}');
  });

  it('labels chi exposures with role=server and static confidence', async () => {
    const exposures = await adapter.findExposures!(GO_REST_REPO);
    for (const ex of exposures) {
      expect(ex.type).toBe('rest-endpoint');
      expect(ex.role).toBe('server');
      expect(ex.confidence).toBe('static');
      expect(ex.source.path.endsWith('router.go')).toBe(true);
      expect(typeof ex.source.line).toBe('number');
    }
  });

  it('detect() returns detected=true when any route is found', async () => {
    const result = await adapter.detect(GO_REST_REPO);
    expect(result.detected).toBe(true);
  });

  it('returns no exposures for a Java repo (Spring support deferred)', async () => {
    const exposures = await adapter.findExposures!(JAVA_REPO);
    expect(exposures).toEqual([]);
  });
});
