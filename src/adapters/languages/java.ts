import { readFileSync } from 'node:fs';
import glob from 'fast-glob';
import type { CodeWikiAdapter, LanguageDetection } from '../types.js';

export class JavaAdapter implements CodeWikiAdapter {
  name = 'java' as const;
  type = 'language' as const;
  filePatterns = ['**/build.gradle', '**/build.gradle.kts', '**/pom.xml'];

  async detect(repoPath: string): Promise<LanguageDetection> {
    const gradleFiles = await glob(
      ['build.gradle', 'build.gradle.kts'],
      { cwd: repoPath, absolute: true }
    );
    const pomFiles = await glob(
      ['pom.xml'],
      { cwd: repoPath, absolute: true }
    );

    if (gradleFiles.length > 0) {
      return this.parseGradle(gradleFiles[0]);
    }
    if (pomFiles.length > 0) {
      return this.parsePom();
    }
    return { detected: false, details: { language: 'java' } };
  }

  private parseGradle(filePath: string): LanguageDetection {
    const content = readFileSync(filePath, 'utf-8');

    const versionMatch = content.match(
      /sourceCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)/
    );
    const javaVersion = versionMatch ? versionMatch[1] : undefined;

    const dependencies: Array<{
      name: string;
      version: string;
      scope?: string;
    }> = [];

    const depRegex =
      /(implementation|runtimeOnly|compileOnly|testImplementation|api)\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = depRegex.exec(content)) !== null) {
      const scope = match[1];
      const artifact = match[2];
      const parts = artifact.split(':');
      // Use artifact ID (index 1) as name, or full string if no colon
      const name = parts.length >= 2 ? parts[1] : artifact;
      const version = parts.length >= 3 ? parts[2] : 'managed';
      dependencies.push({
        name,
        version,
        scope:
          scope === 'testImplementation'
            ? 'test'
            : scope === 'runtimeOnly'
              ? 'runtime'
              : undefined,
      });
    }

    return {
      detected: true,
      details: {
        language: 'java',
        version: javaVersion,
        build_tool: 'gradle',
        dependencies,
      },
    };
  }

  private parsePom(): LanguageDetection {
    return {
      detected: true,
      details: {
        language: 'java',
        build_tool: 'maven',
      },
    };
  }
}
