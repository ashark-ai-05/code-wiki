#!/usr/bin/env node
import { Command } from 'commander';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { fingerprint } from '../src/scanner/fingerprint.js';
import { fingerprintRepo } from '../src/scanner/fingerprint.js';
import { buildGraph } from '../src/graph/builder.js';
import { writeGraph } from '../src/graph/writer.js';
import { generateWiki } from '../src/wiki/generator.js';
import { loadConfig } from '../src/config/loader.js';
import { runMcpServer } from '../src/mcp/server.js';
import { publishFingerprint } from '../src/federation/publish.js';
import { pullFederation } from '../src/federation/pull.js';
import { mergeFederation } from '../src/federation/merge.js';
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

program
  .command('mcp')
  .description('Run as an MCP server over stdio')
  .action(async () => {
    try {
      await runMcpServer({
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (err) {
      console.error('[code-wiki mcp]', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('publish')
  .description('Publish this repo\'s fingerprint to the federation repo')
  .option('-p, --path <path>', 'Path to the repo to scan', process.cwd())
  .option('-c, --config <config>', 'Path to code-wiki.yaml', 'code-wiki.yaml')
  .action(async (options: { path: string; config: string }) => {
    const config = loadConfig(options.config);
    if (!config.federation?.enabled) {
      console.error('federation is not enabled in code-wiki.yaml');
      process.exit(1);
    }
    const registry = AdapterRegistry.withBuiltins();
    const fp = await fingerprintRepo(path.resolve(options.path), registry);
    const result = await publishFingerprint({
      fingerprint: fp,
      config: config.federation,
      commitSha: fp.repo.sha,
    });
    console.log(
      `published ${result.fingerprint_file} → branch ${result.branch} (pushed=${result.pushed})`
    );
  });

program
  .command('pull')
  .description('Clone or update the federation repo under ~/.code-wiki/org/')
  .option('-c, --config <config>', 'Path to code-wiki.yaml', 'code-wiki.yaml')
  .action(async (options: { config: string }) => {
    const config = loadConfig(options.config);
    if (!config.federation?.enabled) {
      console.error('federation is not enabled in code-wiki.yaml');
      process.exit(1);
    }
    const result = await pullFederation({ config: config.federation });
    console.log(`federation repo at: ${result.localDir}`);
  });

program
  .command('merge')
  .description('Rebuild the org graph from all fingerprints (runs inside the federation repo)')
  .option('-d, --dir <dir>', 'Federation repo root', process.cwd())
  .action(async (options: { dir: string }) => {
    const root = path.resolve(options.dir);
    const fingerprintsDir = path.join(root, 'fingerprints');
    const graphDir = path.join(root, 'graph');
    const result = mergeFederation({ fingerprintsDir, graphDir });
    console.log(
      `merge: ${result.merged.length} fingerprints merged, ${result.skipped.length} skipped, changed=${result.changed}`
    );
  });

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
