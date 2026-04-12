import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../src/adapters/languages/go.js';
import type { LanguageDetection } from '../../src/adapters/types.js';
import path from 'node:path';

const GO_REPO = path.join(
  import.meta.dirname, '..', 'fixtures', 'repos', 'go-service'
);

describe('GoAdapter', () => {
  const adapter = new GoAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('go');
    expect(adapter.type).toBe('language');
    expect(adapter.filePatterns).toContain('**/go.mod');
  });

  it('detects Go from go.mod', async () => {
    const result = (await adapter.detect(GO_REPO)) as LanguageDetection;
    expect(result.detected).toBe(true);
    expect(result.details.language).toBe('go');
    expect(result.details.version).toBe('1.22.3');
    expect(result.details.build_tool).toBe('go');
  });

  it('extracts direct dependencies', async () => {
    const result = (await adapter.detect(GO_REPO)) as LanguageDetection;
    const deps = result.details.dependencies ?? [];
    expect(deps.some((d) => d.name === 'github.com/go-chi/chi/v5')).toBe(true);
    expect(deps.some((d) => d.name === 'github.com/segmentio/kafka-go')).toBe(true);
  });

  it('marks indirect dependencies with scope', async () => {
    const result = (await adapter.detect(GO_REPO)) as LanguageDetection;
    const deps = result.details.dependencies ?? [];
    const indirect = deps.find((d) => d.name === 'github.com/klauspost/compress');
    expect(indirect).toBeDefined();
    expect(indirect!.scope).toBe('indirect');
  });

  it('returns detected: false for non-Go repo', async () => {
    const result = await adapter.detect(
      path.join(import.meta.dirname, '..', 'fixtures', 'configs')
    );
    expect(result.detected).toBe(false);
  });
});
