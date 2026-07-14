/**
 * najm — the CLI binary (RFC-0011)
 * =================================================================
 * Invoked as `npx tsx cli/najm.ts <command>` (wired up as `npm run cli
 * -- <command>` in this repo's own package.json) — see this file's
 * bottom section and the RFC-0011 Verification notes for why this repo
 * does NOT publish a package.json "bin" entry pointing straight at
 * this .ts file: Node cannot execute a .ts file with extensionless
 * relative imports (this codebase's convention throughout) without a
 * loader, so a real global-install/npx binary needs either a compiled
 * .js entry point or a shebang-wrapped shell script that re-execs
 * through `tsx` — genuine follow-up work once packages/ actually
 * publishes (RFC-0018/0019), not invented speculatively here.
 *
 * Plain argument parsing, no CLI framework dependency — six
 * subcommands with a handful of flags doesn't earn commander/yargs
 * per RFC-0001's anti-speculation stance.
 *
 *   najm dev [--port <n>]
 *   najm build
 *   najm preview [--port <n>]
 *   najm doctor
 *   najm lint
 *   najm create-najm-app <dir>   (RFC-0011 also names this a standalone
 *                                 `create-najm-app <dir>` binary once
 *                                 published; today it's this same
 *                                 dispatcher's subcommand — see above)
 *
 * `dev`/`build`/`preview` are thin wrappers: they `spawn` the exact,
 * unchanged server/*.ts entry point via `tsx`, with `--port` mapped to
 * the PORT env var those scripts already read (grep-confirmed in
 * server/dev.ts and server/serve.ts). This file does not import
 * server/dev.ts's module directly and re-execute it in-process,
 * because dev.ts and serve.ts both start listening as an unconditional
 * side effect of being loaded (top-level `http.createServer(...).listen()`)
 * — spawning a real child process is the only way to get proper
 * process lifecycle (Ctrl+C, exit code passthrough) for a long-running
 * server, and keeps this wrapper from having to special-case "this
 * script never returns."
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runDoctor, formatDoctorReport } from './doctor';
import { lintDir, formatLintReport } from './lint';
import { scaffoldApp } from './scaffold';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Minimal flag parsing — enough for --port <n> and nothing more.      */
/* ------------------------------------------------------------------ */

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return flags;
}

/** Spawn `tsx <scriptRelPath>` as a real child process, wiring PORT + stdio. */
function runServerScript(scriptRelPath: string, port: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (port) env.PORT = port;
    const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsxCli, path.join(root, scriptRelPath)], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Subcommands                                                         */
/* ------------------------------------------------------------------ */

async function cmdDev(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  return runServerScript('server/dev.ts', flags.port);
}

async function cmdBuild(): Promise<number> {
  return runServerScript('server/build.ts', undefined);
}

async function cmdPreview(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  return runServerScript('server/serve.ts', flags.port);
}

function cmdDoctor(): number {
  const result = runDoctor(root);
  console.log(formatDoctorReport(result));
  return result.healthy ? 0 : 1;
}

function cmdLint(): number {
  const srcDir = path.join(root, 'src');
  const diagnostics = lintDir(srcDir);
  console.log(formatLintReport(diagnostics, root));
  return diagnostics.length === 0 ? 0 : 1;
}

function cmdCreateApp(argv: string[]): number {
  const dir = argv[0];
  if (!dir) {
    console.error('usage: create-najm-app <dir>');
    return 1;
  }
  const target = path.resolve(process.cwd(), dir);
  const result = scaffoldApp(target);
  console.log(`\n  ▲ create-najm-app — scaffolded ${result.filesWritten.length} file(s) in ${target}\n`);
  for (const f of result.filesWritten) console.log(`    ${f}`);
  console.log('');
  return 0;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

function usage(): void {
  console.log(`usage: najm <command> [options]

commands:
  dev [--port <n>]      start the dev server
  build                  produce a production build in dist/
  preview [--port <n>]  serve the production build
  doctor                 run setup diagnostics
  lint                    check every .najm file under src/ compiles

  create-najm-app <dir>  scaffold a new Najm project
`);
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'dev':
      return cmdDev(rest);
    case 'build':
      return cmdBuild();
    case 'preview':
      return cmdPreview(rest);
    case 'doctor':
      return cmdDoctor();
    case 'lint':
      return cmdLint();
    case 'create-najm-app':
      return cmdCreateApp(rest);
    case undefined:
    case '--help':
    case '-h':
      usage();
      return command === undefined ? 1 : 0;
    default:
      console.error(`najm: unknown command "${command}"\n`);
      usage();
      return 1;
  }
}

// Only run when this file is the process entry point (not when
// imported by tests) — the standard ESM "is this the main module" check.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
