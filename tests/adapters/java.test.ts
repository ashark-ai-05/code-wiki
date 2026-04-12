import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../src/adapters/languages/java.js';

const fixtureRepoPath = new URL('../fixtures/repos/java-service', import.meta.url).pathname;
const nonJavaPath = new URL('../fixtures/configs', import.meta.url).pathname;

describe('JavaAdapter', () => {
  const adapter = new JavaAdapter();

  it('has correct metadata', () => {
    expect(adapter.name).toBe('java');
    expect(adapter.type).toBe('language');
    expect(adapter.filePatterns).toContain('**/build.gradle');
    expect(adapter.filePatterns).toContain('**/pom.xml');
  });

  it('detects Java from build.gradle', async () => {
    const result = await adapter.detect(fixtureRepoPath);
    expect(result.detected).toBe(true);
    expect(result.details.language).toBe('java');
    expect(result.details.version).toBe('17');
    expect(result.details.build_tool).toBe('gradle');
  });

  it('extracts dependencies from build.gradle', async () => {
    const result = await adapter.detect(fixtureRepoPath);
    expect(result.detected).toBe(true);
    const depNames = result.details.dependencies?.map((d) => d.name) ?? [];
    expect(depNames).toContain('spring-boot-starter-web');
    expect(depNames).toContain('spring-kafka');
    expect(depNames).toContain('ojdbc11');
  });

  it('returns detected:false for non-Java repo', async () => {
    const result = await adapter.detect(nonJavaPath);
    expect(result.detected).toBe(false);
  });
});
