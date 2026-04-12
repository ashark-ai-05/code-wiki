import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { CodeWikiConfig } from './schema.js';
import { applyDefaults } from './defaults.js';

export function loadConfig(filePath: string): CodeWikiConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parse(raw) as Record<string, unknown>;

  // Validate required fields
  if (!parsed['version']) {
    throw new Error(
      'Invalid config: missing required field "version"',
    );
  }

  if (!Array.isArray(parsed['sources'])) {
    throw new Error(
      'Invalid config: "sources" must be an array',
    );
  }

  const output = parsed['output'] as Record<string, unknown> | undefined;
  if (!output || !output['wiki_path']) {
    throw new Error(
      'Invalid config: missing required field "output.wiki_path"',
    );
  }

  const config = parsed as unknown as CodeWikiConfig;

  return applyDefaults(config);
}
