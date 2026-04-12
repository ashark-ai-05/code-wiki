#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('code-wiki')
  .description('Self-maintaining codebase intelligence platform')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan the codebase and extract intelligence')
  .option('-p, --path <path>', 'path to scan', '.')
  .option('-c, --config <config>', 'path to config file', 'code-wiki.yaml')
  .action((options) => {
    console.log('scan command (stub)');
    console.log('  path:', options.path);
    console.log('  config:', options.config);
  });

program
  .command('build')
  .description('Build the wiki output from scanned data')
  .option('-c, --config <config>', 'path to config file', 'code-wiki.yaml')
  .action((options) => {
    console.log('build command (stub)');
    console.log('  config:', options.config);
  });

program.parse(process.argv);
