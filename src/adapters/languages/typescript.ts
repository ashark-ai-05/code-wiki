import { readFileSync } from 'node:fs';
import glob from 'fast-glob';
import path from 'node:path';
import type { CodeWikiAdapter, LanguageDetection } from '../types.js';

export class TypeScriptAdapter implements CodeWikiAdapter {
  name = 'typescript' as const;
  type = 'language' as const;
  filePatterns = ['**/package.json'];

  async detect(repoPath: string): Promise<LanguageDetection> {
    const packageFiles = await glob(['package.json'], {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    if (packageFiles.length === 0) {
      return { detected: false, details: { language: 'typescript' } };
    }

    return this.parsePackageJson(packageFiles[0]);
  }

  private parsePackageJson(filePath: string): LanguageDetection {
    const content = readFileSync(filePath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;

    const deps =
      (pkg.dependencies as Record<string, string> | undefined) ?? {};
    const devDeps =
      (pkg.devDependencies as Record<string, string> | undefined) ?? {};

    const isTypeScript = 'typescript' in devDeps || 'typescript' in deps;
    const language = isTypeScript ? 'typescript' : 'javascript';

    const tsVersion = devDeps.typescript ?? deps.typescript;
    const version = tsVersion
      ? tsVersion.replace(/[\^~]/, '')
      : undefined;

    const dependencies: Array<{
      name: string;
      version: string;
      scope?: string;
    }> = [];

    for (const [name, ver] of Object.entries(deps)) {
      dependencies.push({
        name,
        version: (ver as string).replace(/[\^~]/, ''),
      });
    }
    for (const [name, ver] of Object.entries(devDeps)) {
      dependencies.push({
        name,
        version: (ver as string).replace(/[\^~]/, ''),
        scope: 'dev',
      });
    }

    const dir = path.dirname(filePath);
    const hasYarn =
      glob.sync(['yarn.lock'], { cwd: dir }).length > 0;
    const hasPnpm =
      glob.sync(['pnpm-lock.yaml'], { cwd: dir }).length > 0;
    const buildTool = hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm';

    return {
      detected: true,
      details: { language, version, build_tool: buildTool, dependencies },
    };
  }
}
