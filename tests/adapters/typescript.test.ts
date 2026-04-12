import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../../src/adapters/languages/typescript.js';
import type { LanguageDetection } from '../../src/adapters/types.js';
import path from 'node:path';

const TS_REPO = path.join(
  import.meta.dirname, '..', 'fixtures', 'repos', 'ts-service'
);

describe('TypeScriptAdapter', () => {
  const adapter = new TypeScriptAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('typescript');
    expect(adapter.type).toBe('language');
    expect(adapter.filePatterns).toContain('**/package.json');
  });

  it('detects TypeScript from package.json', async () => {
    const result = (await adapter.detect(TS_REPO)) as LanguageDetection;
    expect(result.detected).toBe(true);
    expect(result.details.language).toBe('typescript');
    expect(result.details.build_tool).toBe('npm');
  });

  it('extracts dependencies', async () => {
    const result = (await adapter.detect(TS_REPO)) as LanguageDetection;
    const deps = result.details.dependencies ?? [];
    expect(deps.some((d) => d.name === 'express')).toBe(true);
    expect(deps.some((d) => d.name === 'kafkajs')).toBe(true);
    expect(deps.some((d) => d.name === 'ws')).toBe(true);
    expect(
      deps.some((d) => d.name === 'typescript' && d.scope === 'dev')
    ).toBe(true);
  });

  it('detects TS when typescript is a devDependency', async () => {
    const result = (await adapter.detect(TS_REPO)) as LanguageDetection;
    expect(result.details.language).toBe('typescript');
  });

  it('returns detected: false for non-JS/TS repo', async () => {
    const result = await adapter.detect(
      path.join(import.meta.dirname, '..', 'fixtures', 'configs')
    );
    expect(result.detected).toBe(false);
  });
});
