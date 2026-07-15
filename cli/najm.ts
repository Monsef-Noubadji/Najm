#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDoctor, formatDoctorReport } from './doctor';
import { lintDir, formatLintReport } from './lint';
import { scaffoldApp } from './scaffold';
import { parseArgv, parsePort, rejectUnknownFlags } from './args';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = path.resolve(here, '..');

function readVersion(): string {
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
  console.log(`usage: najm <command> [options]

commands:
  najm dev [--port <n>]         start the dev server
  najm build                    produce a production build in dist/
  najm preview [--port <n>]     serve the production build
  najm doctor                   run setup diagnostics
  najm lint                     check every .najm file under src/ compiles
  najm create <dir>             scaffold a new Najm project and run pnpm install
  najm create-najm-app <dir>    compatibility alias for najm create
  najm test                     deferred in this release

options:
  --help                        show help
  --version                     print version
`);
}

function fail(message: string): number {
  console.error(message);
  usage();
  return 1;
}

async function resolveServerEntry(name: 'dev' | 'build' | 'serve'): Promise<{ command: string; args: string[] }> {
  const sourceEntry = path.join(sourceRepoRoot, 'server', `${name}.ts`);
  const tsxCli = path.join(sourceRepoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(sourceEntry) && fs.existsSync(tsxCli)) {
    return { command: process.execPath, args: [tsxCli, sourceEntry] };
  }

  const resolved = await import.meta.resolve(`@monsef-nbj/najm-server/${name}`);
  return { command: process.execPath, args: [fileURLToPath(resolved)] };
}

async function runServerScript(name: 'dev' | 'build' | 'serve', cwd: string, port: string | undefined): Promise<number> {
  const entry = await resolveServerEntry(name);
  const env = { ...process.env };
  if (port) env.PORT = port;

  return await new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    const forwardSigint = (): void => {
      if (child.exitCode === null) child.kill('SIGINT');
    };
    const forwardSigterm = (): void => {
      if (child.exitCode === null) child.kill('SIGTERM');
    };
    process.once('SIGINT', forwardSigint);
    process.once('SIGTERM', forwardSigterm);

    child.on('exit', (code) => {
      process.off('SIGINT', forwardSigint);
      process.off('SIGTERM', forwardSigterm);
      resolve(code ?? 0);
    });
    child.on('error', reject);
  });
}

function ensureNoArgs(args: string[]): string | undefined {
  return args[0] ? `unexpected argument "${args[0]}"` : undefined;
}

async function cmdDev(args: string[], flags: Record<string, string | true>, cwd: string): Promise<number> {
  const unknown = rejectUnknownFlags(flags, ['port']);
  if (unknown) return fail(unknown);
  const unexpected = ensureNoArgs(args);
  if (unexpected) return fail(unexpected);
  const port = parsePort(flags.port);
  if (!port.ok) return fail(port.message);
  return runServerScript('dev', cwd, port.port);
}

async function cmdBuild(args: string[], flags: Record<string, string | true>, cwd: string): Promise<number> {
  const unknown = rejectUnknownFlags(flags, []);
  if (unknown) return fail(unknown);
  const unexpected = ensureNoArgs(args);
  if (unexpected) return fail(unexpected);
  return runServerScript('build', cwd, undefined);
}

async function cmdPreview(args: string[], flags: Record<string, string | true>, cwd: string): Promise<number> {
  const unknown = rejectUnknownFlags(flags, ['port']);
  if (unknown) return fail(unknown);
  const unexpected = ensureNoArgs(args);
  if (unexpected) return fail(unexpected);
  const port = parsePort(flags.port);
  if (!port.ok) return fail(port.message);
  return runServerScript('serve', cwd, port.port);
}

function cmdDoctor(args: string[], flags: Record<string, string | true>, cwd: string): number {
  const unknown = rejectUnknownFlags(flags, []);
  if (unknown) return fail(unknown);
  const unexpected = ensureNoArgs(args);
  if (unexpected) return fail(unexpected);
  const result = runDoctor(cwd);
  console.log(formatDoctorReport(result));
  return result.healthy ? 0 : 1;
}

function cmdLint(args: string[], flags: Record<string, string | true>, cwd: string): number {
  const unknown = rejectUnknownFlags(flags, []);
  if (unknown) return fail(unknown);
  const unexpected = ensureNoArgs(args);
  if (unexpected) return fail(unexpected);
  const diagnostics = lintDir(path.join(cwd, 'src'));
  console.log(formatLintReport(diagnostics, cwd));
  return diagnostics.length === 0 ? 0 : 1;
}

function cmdCreate(args: string[], flags: Record<string, string | true>, cwd: string): number {
  const unknown = rejectUnknownFlags(flags, []);
  if (unknown) return fail(unknown);
  const dir = args[0];
  if (!dir) return fail('missing required argument "<dir>"');
  if (args[1]) return fail(`unexpected argument "${args[1]}"`);

  try {
    const target = path.resolve(cwd, dir);
    const result = scaffoldApp(target, { install: true, packageVersion: scaffoldPackageVersion() });
    console.log(`\n  Najm project created in ${result.dir}\n`);
    return result.installOk ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(argv: string[], opts: { cwd?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const parsed = parseArgv(argv);
  const { command, args, flags } = parsed;

  if (!command && (flags.help || flags.h)) {
    usage();
    return 0;
  }

  if (!command && flags.version) {
    console.log(readVersion());
    return 0;
  }

  switch (command) {
    case 'dev':
      return cmdDev(args, flags, cwd);
    case 'build':
      return cmdBuild(args, flags, cwd);
    case 'preview':
      return cmdPreview(args, flags, cwd);
    case 'doctor':
      return cmdDoctor(args, flags, cwd);
    case 'lint':
      return cmdLint(args, flags, cwd);
    case 'create':
    case 'create-najm-app':
      return cmdCreate(args, flags, cwd);
    case 'test':
      console.error("najm test is deferred for this release. Use your project's package.json test script.");
      return 1;
    case '--version':
      console.log(readVersion());
      return 0;
    case undefined:
    case '--help':
    case '-h':
      usage();
      return command === undefined ? 1 : 0;
    default:
      return fail(`najm: unknown command "${command}"`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
