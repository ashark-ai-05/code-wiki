import { readFileSync, existsSync } from 'node:fs';
import { glob } from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import type { CodeWikiAdapter, CommunicationDetection } from '../types.js';

export class KafkaAdapter implements CodeWikiAdapter {
  name = 'kafka' as const;
  type = 'communication' as const;
  filePatterns = [
    '**/application.yaml',
    '**/application.yml',
    '**/package.json',
  ];

  async detect(repoPath: string): Promise<CommunicationDetection> {
    const topics: string[] = [];
    const configFiles: string[] = [];
    let hasProducer = false;
    let hasConsumer = false;

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
      const found = this.parseSpringKafkaConfig(configFile);
      if (found.topics.length > 0) {
        topics.push(...found.topics);
        configFiles.push(path.relative(repoPath, configFile));
        if (found.hasProducer) hasProducer = true;
        if (found.hasConsumer) hasConsumer = true;
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
        if (!configFiles.length) configFiles.push('package.json');
        hasProducer = true;
        hasConsumer = true;
      }
    }

    if (topics.length === 0 && !hasProducer && !hasConsumer) {
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

    const role =
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
        identifiers: [...new Set(topics)],
        config_files: configFiles,
      },
    };
  }

  private parseSpringKafkaConfig(filePath: string): {
    topics: string[];
    hasProducer: boolean;
    hasConsumer: boolean;
  } {
    const content = readFileSync(filePath, 'utf-8');
    const topics: string[] = [];
    let hasProducer = false;
    let hasConsumer = false;

    try {
      const yaml = parseYaml(content) as Record<string, unknown>;
      const spring = yaml?.spring as Record<string, unknown> | undefined;
      const kafka = spring?.kafka as Record<string, unknown> | undefined;

      if (!kafka) return { topics, hasProducer, hasConsumer };

      if (kafka.producer) hasProducer = true;
      if (kafka.consumer) hasConsumer = true;

      const template = kafka.template as
        | Record<string, unknown>
        | undefined;
      if (template?.['default-topic']) {
        topics.push(String(template['default-topic']));
      }

      this.extractTopicStrings(yaml, topics);
    } catch {
      const topicRegex =
        /topic[s]?\s*[:=]\s*['"]?([a-zA-Z0-9._-]+)/gi;
      let match;
      while ((match = topicRegex.exec(content)) !== null) {
        const candidate = match[1];
        if (
          candidate.includes('.') &&
          !candidate.startsWith('org.') &&
          !candidate.startsWith('io.')
        ) {
          topics.push(candidate);
        }
      }
    }

    return { topics, hasProducer, hasConsumer };
  }

  private extractTopicStrings(
    obj: unknown,
    topics: string[],
    depth = 0
  ): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const keyLower = key.toLowerCase();
        if (
          (keyLower.includes('topic') ||
            keyLower === 'dlq' ||
            keyLower === 'outbound' ||
            keyLower === 'inbound') &&
          value.includes('.') &&
          !value.startsWith('org.') &&
          !value.startsWith('io.') &&
          !value.startsWith('com.') &&
          !value.includes('/')
        ) {
          topics.push(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        this.extractTopicStrings(value, topics, depth + 1);
      }
    }
  }
}
