#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldApp } from './scaffold';

function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'packages', 'najm', 'package.json'),
    path.resolve(here, '..', 'package.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')).version;
    }
  }

  return '0.0.0';
}

function scaffoldPackageVersion(): string {
  return process.env.NAJM_CREATE_PACKAGE_VERSION || readVersion();
}

function usage(): void {
  console.log(`usage: create-najm-app <dir>

commands:
  create-najm-app <dir>  scaffold a new Najm project and run pnpm install

options:
  --help                 show help
  --version              print version
`);
}

export async function runCreateApp(argv: string[], opts: { cwd?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const [first, second] = argv;

  if (first === '--help' || first === '-h') {
    usage();
    return 0;
  }

  if (first === '--version') {
    console.log(readVersion());
    return 0;
  }

  if (!first) {
    usage();
    return 1;
  }

  if (second) {
    console.error(`unexpected argument "${second}"`);
    usage();
    return 1;
  }

  try {
    const target = path.resolve(cwd, first);
    const result = scaffoldApp(target, { install: true, packageVersion: scaffoldPackageVersion() });
    console.log(`\n  Najm project created in ${result.dir}\n`);
    return result.installOk ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runCreateApp(process.argv.slice(2)).then((code) => process.exit(code));
