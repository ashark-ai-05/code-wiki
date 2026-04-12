import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/loader.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(__dirname, '../fixtures/configs');

describe('loadConfig', () => {
  it('loads a valid config correctly', () => {
    const config = loadConfig(resolve(fixturesDir, 'valid-config.yaml'));

    expect(config.version).toBe('1.0');
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].provider).toBe('local');
    expect(config.workflows).toHaveProperty('test-workflow');
    expect(config.workflows['test-workflow'].entry_points).toContain('svc-a');
    expect(config.output.wiki_path).toBe('./wiki-output');
    expect(config.output.index_mode).toBe('json');
  });

  it('throws "Config file not found" for a missing file', () => {
    expect(() =>
      loadConfig(resolve(fixturesDir, 'does-not-exist.yaml')),
    ).toThrow('Config file not found');
  });

  it('throws an error mentioning "version" for a config missing version', () => {
    expect(() =>
      loadConfig(resolve(fixturesDir, 'invalid-no-version.yaml')),
    ).toThrow('version');
  });

  it('applies defaults for optional fields when using minimal config', () => {
    const config = loadConfig(resolve(fixturesDir, 'minimal-config.yaml'));

    // Output defaults
    expect(config.output.diagram_format).toBe('mermaid');
    expect(config.output.render_diagrams).toBe(true);
    expect(config.output.markdown_style).toBe('github');
    expect(config.output.git_enabled).toBe(true);

    // Analysis scan defaults
    expect(config.analysis?.scan?.shallow_all_repos).toBe(true);
    expect(config.analysis?.scan?.max_concurrency).toBe(4);

    // Analysis detection defaults
    expect(config.analysis?.detection?.kafka).toBe(true);
    expect(config.analysis?.detection?.rest_api).toBe(true);
  });
});
