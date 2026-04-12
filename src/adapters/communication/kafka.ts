import { readFileSync, existsSync } from 'node:fs';
import glob from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import type {
  CodeWikiAdapter,
  CommunicationDetection,
  Exposure,
} from '../types.js';

interface TopicHit {
  topic: string;
  role: 'producer' | 'consumer' | 'both';
  line?: number;
}

export class KafkaAdapter implements CodeWikiAdapter {
  name = 'kafka' as const;
  type = 'communication' as const;
  filePatterns = [
    '**/application.yaml',
    '**/application.yml',
    '**/package.json',
  ];

  async detect(repoPath: string): Promise<CommunicationDetection> {
    const exposures = await this.findExposures(repoPath);
    if (exposures.length === 0) {
      return {
        detected: false,
        details: {
          type: 'kafka',
          role: 'both',
          identifiers: [],
          config_files: [],
        },
      };
    }

    const roles = new Set(exposures.map((e) => e.role));
    const hasProducer = roles.has('producer') || roles.has('both');
    const hasConsumer = roles.has('consumer') || roles.has('both');
    const role: CommunicationDetection['details']['role'] =
      hasProducer && hasConsumer
        ? 'both'
        : hasProducer
          ? 'producer'
          : 'consumer';

    return {
      detected: true,
      details: {
        type: 'kafka',
        role,
        identifiers: [...new Set(exposures.map((e) => e.identifier))],
        config_files: [...new Set(exposures.map((e) => e.source.path))],
      },
    };
  }

  async findExposures(repoPath: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    const springConfigs = await glob(
      [
        '**/application.yaml',
        '**/application.yml',
        '**/application*.yaml',
        '**/application*.yml',
      ],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/build/**', '**/target/**'],
      }
    );

    for (const configFile of springConfigs) {
      const rel = path.relative(repoPath, configFile);
      const hits = this.parseSpringKafkaConfig(configFile);
      for (const hit of hits) {
        exposures.push({
          type: 'kafka-topic',
          identifier: hit.topic,
          role: hit.role,
          source: { path: rel, line: hit.line },
          detection_method: 'static',
          confidence: 'static',
        });
      }
    }

    const packageJson = path.join(repoPath, 'package.json');
    if (existsSync(packageJson)) {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (
        'kafkajs' in allDeps ||
        '@confluentinc/kafka-javascript' in allDeps
      ) {
        exposures.push({
          type: 'kafka-topic',
          identifier: '<unknown>',
          role: 'both',
          source: { path: 'package.json' },
          detection_method: 'inferred',
          confidence: 'inferred',
        });
      }
    }

    return exposures;
  }

  private parseSpringKafkaConfig(filePath: string): TopicHit[] {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const hits: TopicHit[] = [];

    let hasProducer = false;
    let hasConsumer = false;

    try {
      const yaml = parseYaml(content) as Record<string, unknown>;
      const spring = yaml?.spring as Record<string, unknown> | undefined;
      const kafka = spring?.kafka as Record<string, unknown> | undefined;

      if (kafka?.producer) hasProducer = true;
      if (kafka?.consumer) hasConsumer = true;

      const roleOf = (): TopicHit['role'] =>
        hasProducer && hasConsumer
          ? 'both'
          : hasProducer
            ? 'producer'
            : hasConsumer
              ? 'consumer'
              : 'both';

      this.collectTopicsWithLines(yaml, lines, hits, roleOf, 0);
    } catch {
      const topicRegex = /topic[s]?\s*[:=]\s*['"]?([a-zA-Z0-9._-]+)/gi;
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(topicRegex)) {
          const candidate = m[1];
          if (
            candidate.includes('.') &&
            !candidate.startsWith('org.') &&
            !candidate.startsWith('io.')
          ) {
            hits.push({ topic: candidate, role: 'both', line: i + 1 });
          }
        }
      }
    }

    return hits;
  }

  private collectTopicsWithLines(
    obj: unknown,
    lines: string[],
    hits: TopicHit[],
    roleOf: () => TopicHit['role'],
    depth: number
  ): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const keyLower = key.toLowerCase();
        const looksLikeTopic =
          (keyLower.includes('topic') ||
            keyLower === 'dlq' ||
            keyLower === 'outbound' ||
            keyLower === 'inbound' ||
            keyLower === 'default-topic') &&
          value.includes('.') &&
          !value.startsWith('org.') &&
          !value.startsWith('io.') &&
          !value.startsWith('com.') &&
          !value.includes('/');

        if (looksLikeTopic) {
          hits.push({
            topic: value,
            role: roleOf(),
            line: findLineOfString(lines, value),
          });
        }
      } else if (typeof value === 'object' && value !== null) {
        this.collectTopicsWithLines(value, lines, hits, roleOf, depth + 1);
      }
    }
  }
}

function findLineOfString(lines: string[], needle: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return undefined;
}
