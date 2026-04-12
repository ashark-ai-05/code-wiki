import { readFileSync } from 'node:fs';
import glob from 'fast-glob';
import path from 'node:path';
import type {
  CodeWikiAdapter,
  CommunicationDetection,
  Exposure,
} from '../types.js';

const CHI_METHOD_CALL =
  /\br\.(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]+)"/g;

export class RestAdapter implements CodeWikiAdapter {
  name = 'rest' as const;
  type = 'communication' as const;
  filePatterns = ['**/*.go'];

  async detect(repoPath: string): Promise<CommunicationDetection> {
    const exposures = await this.findExposures(repoPath);
    if (exposures.length === 0) {
      return {
        detected: false,
        details: {
          type: 'rest',
          role: 'server',
          identifiers: [],
          config_files: [],
        },
      };
    }
    return {
      detected: true,
      details: {
        type: 'rest',
        role: 'server',
        identifiers: exposures.map((e) => e.identifier),
        config_files: [...new Set(exposures.map((e) => e.source.path))],
      },
    };
  }

  async findExposures(repoPath: string): Promise<Exposure[]> {
    const goFiles = await glob(['**/*.go'], {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/vendor/**', '**/testdata/**', '**/*_test.go'],
    });

    const exposures: Exposure[] = [];
    for (const file of goFiles) {
      exposures.push(...this.scanGoChiFile(file, repoPath));
    }
    return exposures;
  }

  private scanGoChiFile(
    absPath: string,
    repoRoot: string
  ): Exposure[] {
    const rel = path.relative(repoRoot, absPath);
    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');
    const found: Exposure[] = [];

    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(CHI_METHOD_CALL)) {
        const method = m[1].toUpperCase();
        const routePath = m[2];
        found.push({
          type: 'rest-endpoint',
          identifier: `${method} ${routePath}`,
          role: 'server',
          source: { path: rel, line: i + 1 },
          detection_method: 'static',
          confidence: 'static',
        });
      }
    }
    return found;
  }
}
