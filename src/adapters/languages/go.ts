import { readFileSync } from 'node:fs';
import glob from 'fast-glob';
import type { CodeWikiAdapter, LanguageDetection } from '../types.js';

export class GoAdapter implements CodeWikiAdapter {
  name = 'go' as const;
  type = 'language' as const;
  filePatterns = ['**/go.mod'];

  async detect(repoPath: string): Promise<LanguageDetection> {
    const goModFiles = await glob(['go.mod'], {
      cwd: repoPath,
      absolute: true,
    });

    if (goModFiles.length === 0) {
      return { detected: false, details: { language: 'go' } };
    }

    return this.parseGoMod(goModFiles[0]);
  }

  private parseGoMod(filePath: string): LanguageDetection {
    const content = readFileSync(filePath, 'utf-8');

    const versionMatch = content.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m);
    const goVersion = versionMatch ? versionMatch[1] : undefined;

    const dependencies = this.parseRequires(content);

    return {
      detected: true,
      details: {
        language: 'go',
        version: goVersion,
        build_tool: 'go',
        dependencies,
      },
    };
  }

  private parseRequires(
    content: string
  ): Array<{ name: string; version: string; scope?: string }> {
    const deps: Array<{ name: string; version: string; scope?: string }> = [];

    // Multi-line: require ( ... )
    const blockMatches = content.matchAll(/require\s*\(([^)]*)\)/g);
    for (const block of blockMatches) {
      for (const line of block[1].split('\n')) {
        const dep = this.parseRequireLine(line);
        if (dep) deps.push(dep);
      }
    }

    // Single-line: require module version
    const singleLineMatches = content.matchAll(
      /^require\s+([^\s(]+)\s+(\S+)(?:\s*\/\/\s*(\S+))?/gm
    );
    for (const m of singleLineMatches) {
      deps.push({
        name: m[1],
        version: m[2],
        scope: m[3] === 'indirect' ? 'indirect' : undefined,
      });
    }

    return deps;
  }

  private parseRequireLine(
    line: string
  ): { name: string; version: string; scope?: string } | null {
    const stripped = line.replace(/\/\/.*$/, '').trim();
    if (!stripped) return null;

    const match = stripped.match(/^(\S+)\s+(\S+)/);
    if (!match) return null;

    const isIndirect = /\/\/\s*indirect/.test(line);
    return {
      name: match[1],
      version: match[2],
      scope: isIndirect ? 'indirect' : undefined,
    };
  }
}
