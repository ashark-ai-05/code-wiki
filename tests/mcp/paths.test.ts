import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverGraphPath } from '../../src/mcp/paths.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('discoverGraphPath', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-paths-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns CODE_WIKI_GRAPH env var when set', () => {
    const explicit = path.join(tmp, 'explicit', 'graph');
    mkdirSync(explicit, { recursive: true });
    writeFileSync(
      path.join(explicit, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    const result = discoverGraphPath({
      cwd: tmp,
      env: { CODE_WIKI_GRAPH: explicit },
    });
    expect(result).toBe(explicit);
  });

  it('falls back to ./docs/wiki/graph/ when present', () => {
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    mkdirSync(dwg, { recursive: true });
    writeFileSync(
      path.join(dwg, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(dwg);
  });

  it('falls back to ./code-wiki-output/graph/ when present', () => {
    const out = path.join(tmp, 'code-wiki-output', 'graph');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, 'services.json'),
      '{"schema_version":"2.0","services":[]}'
    );
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(out);
  });

  it('prefers docs/wiki/graph/ over code-wiki-output/graph/', () => {
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    const out = path.join(tmp, 'code-wiki-output', 'graph');
    mkdirSync(dwg, { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(dwg, 'services.json'), '{}');
    writeFileSync(path.join(out, 'services.json'), '{}');
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBe(dwg);
  });

  it('returns null when no graph can be found', () => {
    expect(discoverGraphPath({ cwd: tmp, env: {} })).toBeNull();
  });

  it('env var wins even if other paths exist', () => {
    const explicit = path.join(tmp, 'explicit');
    const dwg = path.join(tmp, 'docs', 'wiki', 'graph');
    mkdirSync(explicit, { recursive: true });
    mkdirSync(dwg, { recursive: true });
    writeFileSync(path.join(explicit, 'services.json'), '{}');
    writeFileSync(path.join(dwg, 'services.json'), '{}');
    const result = discoverGraphPath({
      cwd: tmp,
      env: { CODE_WIKI_GRAPH: explicit },
    });
    expect(result).toBe(explicit);
  });

  it('falls back to ~/.code-wiki/org/graph/ when present and the other paths are not', () => {
    const homeLike = path.join(tmp, 'fake-home');
    const orgGraph = path.join(homeLike, '.code-wiki', 'org', 'graph');
    mkdirSync(orgGraph, { recursive: true });
    writeFileSync(path.join(orgGraph, 'services.json'), '{}');

    const result = discoverGraphPath({
      cwd: tmp,
      env: {},
      homeDir: homeLike,
    });
    expect(result).toBe(orgGraph);
  });
});
