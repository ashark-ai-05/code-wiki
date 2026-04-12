import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import type { CodeWikiAdapter, DetectionResult } from '../../src/adapters/types.js';

function createMockAdapter(name: string, type: string): CodeWikiAdapter {
  return {
    name,
    type: type as CodeWikiAdapter['type'],
    filePatterns: ['**/*.mock'],
    async detect(): Promise<DetectionResult> {
      return { detected: true, details: {} };
    },
  };
}

describe('AdapterRegistry', () => {
  it('registers and retrieves adapters by type', () => {
    const registry = new AdapterRegistry();
    const adapter = createMockAdapter('java', 'language');
    registry.register(adapter);

    const results = registry.getByType('language');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('java');
  });

  it('retrieves adapter by name', () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter('java', 'language'));
    registry.register(createMockAdapter('kafka', 'communication'));

    const kafka = registry.getByName('kafka');
    expect(kafka).toBeDefined();
    expect(kafka?.name).toBe('kafka');

    const nonexistent = registry.getByName('nonexistent');
    expect(nonexistent).toBeUndefined();
  });

  it('lists all registered adapters', () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter('java', 'language'));
    registry.register(createMockAdapter('kafka', 'communication'));
    registry.register(createMockAdapter('docker', 'infrastructure'));

    const all = registry.all();
    expect(all).toHaveLength(3);
  });

  it('prevents duplicate adapter names', () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter('java', 'language'));

    expect(() => {
      registry.register(createMockAdapter('java', 'language'));
    }).toThrow('already registered');
  });

  it('loads built-in adapters', () => {
    const registry = AdapterRegistry.withBuiltins();
    const languages = registry.getByType('language');
    expect(languages.length).toBeGreaterThanOrEqual(3); // java, typescript, go
    const comms = registry.getByType('communication');
    expect(comms.length).toBeGreaterThanOrEqual(2);     // kafka, rest
    expect(registry.getByName('rest')).toBeDefined();
  });
});
