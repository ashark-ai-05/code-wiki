import { describe, it, expect } from 'vitest';
import {
  emptyNarrationBlock,
  findNarrationRegion,
} from '../../src/wiki/narration.js';

describe('emptyNarrationBlock', () => {
  it('emits start + placeholder + end markers', () => {
    const block = emptyNarrationBlock('services/svc-a/overview.md');
    expect(block).toContain('<!-- narrated:start');
    expect(block).toContain('narrated_at=""');
    expect(block).toContain('narrated_model=""');
    expect(block).toContain('<!-- narrated:end -->');
    expect(block).toContain('No narration yet');
    expect(block).toContain('services/svc-a/overview.md');
  });

  it('markers are on their own lines', () => {
    const block = emptyNarrationBlock('x.md');
    const lines = block.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('narrated:start'));
    const endIdx = lines.findIndex((l) => l.includes('narrated:end'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(lines[startIdx].trim().startsWith('<!--')).toBe(true);
    expect(lines[startIdx].trim().endsWith('-->')).toBe(true);
    expect(lines[endIdx].trim()).toBe('<!-- narrated:end -->');
  });
});

describe('findNarrationRegion', () => {
  it('returns byte offsets for an existing narration region', () => {
    const md = [
      '# Title',
      '',
      '<!-- narrated:start narrated_at="2026-01-01" narrated_model="x" -->',
      'prose here',
      '<!-- narrated:end -->',
      '',
      '## Structural',
    ].join('\n');

    const region = findNarrationRegion(md);
    expect(region).not.toBeNull();
    expect(region!.innerStart).toBeGreaterThan(0);
    expect(region!.innerEnd).toBeGreaterThan(region!.innerStart);
    expect(md.slice(region!.innerStart, region!.innerEnd).trim()).toBe(
      'prose here'
    );
  });

  it('returns null when no markers are present', () => {
    expect(findNarrationRegion('# Title\n\nNo markers here.')).toBeNull();
  });

  it('returns null when only start marker is present', () => {
    const md = '# T\n<!-- narrated:start -->\nprose\n';
    expect(findNarrationRegion(md)).toBeNull();
  });
});
