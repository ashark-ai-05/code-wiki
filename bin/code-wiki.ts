#!/usr/bin/env node
import { Command } from 'commander';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { fingerprint } from '../src/scanner/fingerprint.js';
import { buildGraph } from '../src/graph/builder.js';
import { writeGraph } from '../src/graph/writer.js';
import { generateWiki } from '../src/wiki/generator.js';
import { loadConfig } from '../src/config/loader.js';
import path from 'node:path';
import { existsSync } from 'node:fs';

const program = new Command();

program
  .name('code-wiki')
  .description('Self-maintaining codebase intelligence platform')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan repositories and fingerprint tech stacks')
  .option(
    '-p, --path <path>',
    'Path to directory containing repos'
  )
  .option(
    '-c, --config <config>',
    'Path to code-wiki.yaml',
    'code-wiki.yaml'
  )
  .action(
    async (options: { path?: string; config: string }) => {
      const registry = AdapterRegistry.withBuiltins();
      const repoDir = resolveRepoDir(options);

      console.log(`Scanning repos in: ${repoDir}`);
      const fingerprints = await fingerprint(
        repoDir,
        registry
      );

      console.log(
        `\nFound ${fingerprints.length} repositories:\n`
      );
      for (const fp of fingerprints) {
        const langs = fp.tech_stack.languages
          .map((l) => l.language)
          .join(', ');
        const exposeTypes = [
          ...new Set(fp.exposes.map((e) => e.type)),
        ].join(', ');
        const consumeTypes = [
          ...new Set(fp.consumes.map((e) => e.type)),
        ].join(', ');
        console.log(`  ${fp.repo.name}`);
        console.log(
          `    Languages: ${langs || 'none detected'}`
        );
        console.log(
          `    Exposes:   ${exposeTypes || 'none'} (${fp.exposes.length} entries)`
        );
        console.log(
          `    Consumes:  ${consumeTypes || 'none'} (${fp.consumes.length} entries)`
        );
      }

      console.log(
        `\nScan complete. Run 'code-wiki build' to generate wiki.`
      );
    }
  );

program
  .command('build')
  .description('Build wiki and graph from scanned repositories')
  .option(
    '-p, --path <path>',
    'Path to directory containing repos'
  )
  .option(
    '-o, --output <output>',
    'Output directory for wiki',
    './code-wiki-output'
  )
  .option(
    '-c, --config <config>',
    'Path to code-wiki.yaml',
    'code-wiki.yaml'
  )
  .action(
    async (options: {
      path?: string;
      output: string;
      config: string;
    }) => {
      const registry = AdapterRegistry.withBuiltins();
      const repoDir = resolveRepoDir(options);
      const outputDir = path.resolve(options.output);

      console.log(`Scanning repos in: ${repoDir}`);
      const fingerprints = await fingerprint(
        repoDir,
        registry
      );
      console.log(
        `Found ${fingerprints.length} repos. Building graph...`
      );

      const graph = buildGraph(fingerprints);
      console.log(
        `Graph: ${graph.services.length} services, ${graph.edges.length} edges`
      );

      console.log(`Writing graph to: ${outputDir}/graph/`);
      writeGraph(graph, outputDir);

      console.log(`Generating wiki to: ${outputDir}/`);
      generateWiki(graph, outputDir);

      console.log('\nBuild complete!');
      console.log(`  Services: ${graph.services.length}`);
      console.log(`  Edges: ${graph.edges.length}`);
      console.log(`  Wiki: ${outputDir}/index.md`);
    }
  );

function resolveRepoDir(options: {
  path?: string;
  config: string;
}): string {
  if (options.path) {
    return path.resolve(options.path);
  }
  if (existsSync(options.config)) {
    const config = loadConfig(options.config);
    const localSource = config.sources.find(
      (s) => s.provider === 'local'
    );
    if (localSource?.paths?.[0]) {
      return path.resolve(localSource.paths[0]);
    }
  }
  console.error(
    'Error: Provide --path or a code-wiki.yaml with local sources'
  );
  process.exit(1);
}

program.parse();
