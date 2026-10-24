#!/usr/bin/env node
// create-anything-ai: stack catalog CLI for Create Anything AI.
// Commands: list | validate | generate <stack-id> --output <dir> | status

import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadCatalogFromDisk, listCommand, validateCommand, statusCommand, requireStack } from '../lib/commands.js';
import { generateSkeleton, checkStackId } from '../lib/generate.js';
import { assertCliOutputPolicy } from '../lib/paths.js';
import { errorWithCode, formatError, exitCodeFor } from '../lib/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG = path.resolve(__dirname, '..', '..', '..', 'stacks', 'catalog.json');

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const HELP = `create-anything-ai — stack catalog CLI

Usage:
  create-anything-ai list
  create-anything-ai validate
  create-anything-ai status
  create-anything-ai generate <stack-id> --output <dir> [--force] [--dry-run]

Options:
  --output <dir>   Target directory for generate (required)
  --force          Allow overwriting files that already exist in the target
  --dry-run        Print the plan without writing anything
  --catalog <path> Alternative catalog.json path (default: repo stacks/catalog.json)
  --help           Show this help
  --version        Print the generator version

Exit codes:
  0 success · 1 E_INVALID_STACK · 2 E_TARGET_EXISTS · 3 E_UNSAFE_PATH ·
  4 E_CATALOG_INVALID (+count/id/maturity) · 64 E_USAGE · 74 E_IO
`;

function parseArgs(argv) {
  const options = { _: [] };
  const knownFlags = new Set(['output', 'catalog', 'force', 'dry-run', 'help', 'version']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--output' || arg === '--catalog') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw errorWithCode('E_USAGE', `Option ${arg} requires a value`);
      }
      options[arg === '--output' ? 'output' : 'catalog'] = value;
      i++;
    } else if (arg.startsWith('--')) {
      throw errorWithCode('E_USAGE', `Unknown option "${arg}"`);
    } else {
      options._.push(arg);
    }
  }
  return options;
}

/** Resolve the catalog path and the filesystem root writes are allowed in. */
function resolveRoots(options) {
  const catalogPath = options.catalog
    ? path.resolve(options.catalog)
    : DEFAULT_CATALOG;
  // Writes are confined to the output root: the nearest parent of the output
  // directory is resolved per generate call. Here we only constrain catalog location.
  return { catalogPath };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help || argv.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }

  const command = options._[0];
  const catalogPath = resolveRoots(options).catalogPath;

  // Commands that only read the catalog.
  if (command === 'list' || command === 'validate' || command === 'status') {
    if (options._.length > 1) {
      throw errorWithCode('E_USAGE', `Command "${command}" takes no positional arguments`);
    }
    const catalog = loadCatalogFromDisk(catalogPath);
    const output =
      command === 'list' ? listCommand(catalog) : command === 'validate' ? validateCommand(catalog) : statusCommand(catalog);
    process.stdout.write(output + '\n');
    return 0;
  }

  if (command === 'generate') {
    const stackId = options._[1];
    if (options._.length > 2) {
      throw errorWithCode('E_USAGE', 'generate takes exactly one stack id');
    }
    const idCheck = checkStackId(stackId);
    if (!idCheck.ok) {
      throw errorWithCode(idCheck.code, idCheck.message);
    }
    if (!options.output) {
      throw errorWithCode('E_USAGE', 'generate requires --output <dir>');
    }
    const catalog = loadCatalogFromDisk(catalogPath);
    const stack = requireStack(catalog, stackId);
    const absOutput = assertCliOutputPolicy(options.output, {
      cwd: process.cwd(),
      // Protect the repository that owns the catalog from being used as output.
      repoRoot: path.resolve(catalogPath, '..', '..'),
    });
    const report = generateSkeleton(stack, absOutput, {
      // The output directory itself is the write root; every planned path is
      // re-checked to stay inside it. The catalog stays a read-only input.
      allowedRoot: absOutput,
      force: options.force === true,
      dryRun: options.dryRun === true,
    });
    if (report.dryRun) {
      process.stdout.write(`dry-run: would create in ${report.outputDir}\n`);
      for (const entry of report.planned) {
        process.stdout.write(`  ${entry}\n`);
      }
      process.stdout.write('dry-run: no files were written\n');
      return 0;
    }
    process.stdout.write(`Generated skeleton for ${stack.id} in ${report.outputDir}\n`);
    for (const file of report.created) {
      process.stdout.write(`  created: ${file}\n`);
    }
    for (const file of report.forced) {
      process.stdout.write(`  overwritten (--force): ${file}\n`);
    }
    for (const file of report.skipped) {
      process.stdout.write(`  skipped (exists, use --force to overwrite): ${file}\n`);
    }
    process.stdout.write('Next: replace skeleton placeholders and follow docs/QUALITY_GATES.md before claiming maturity.\n');
    return 0;
  }

  throw errorWithCode('E_USAGE', `Unknown command "${command ?? ''}". Run "create-anything-ai --help".`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  // Single source of truth for error formatting and exit codes: lib/errors.js.
  process.stderr.write(`${formatError(err)}\n`);
  process.exitCode = exitCodeFor(err);
}
