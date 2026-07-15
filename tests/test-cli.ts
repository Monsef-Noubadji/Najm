/**
 * CLI test suite — RFC-0011 (`cli/najm.ts`).
 *
 * Covers all six subcommands. `doctor` and `lint` are checked BOTH by
 * calling their handler functions directly (fast, in-process) AND via
 * at least one real subprocess invocation of the actual binary entry
 * point (`cli/najm.ts`) — proving the wire-level "npx tsx cli/najm.ts
 * <command>" path works end to end, not just the internal functions,
 * matching this project's established pattern (see
 * language-server/.dbg-lsp-integration.ts's real stdio round trip for
 * RFC-0012).
 *
 * `najm build`'s wrapper equivalence is checked with a REAL subprocess
 * build (slow, ~seconds, but this is the one case where a structural-
 * only check wouldn't actually prove the wrapper invokes server/build.ts
 * correctly — tests/test-build.ts already pays this same cost for
 * `npm run build` directly). `najm dev`/`najm preview` are checked by
 * spawning the real subprocess, requesting a real page over HTTP on a
 * dedicated port derived from `--port`, and then killing the process —
 * this proves the `--port` flag really reaches `PORT` end to end
 * without needing to leave a long-running dev server open for the rest
 * of the suite.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { runDoctor } from '../cli/doctor';
import { lintSource, lintDir } from '../cli/lint';
import { scaffoldApp } from '../cli/scaffold';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(repoRoot, 'cli', 'najm.ts');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runCli(args: string[], opts: { timeout?: number } = {}): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    process.execPath,
    [tsxCli, cliEntry, ...args],
    { cwd: repoRoot, encoding: 'utf8', timeout: opts.timeout ?? 60_000 }
  );
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? -1 };
}

/* ------------------------------------------------------------------ */
/* najm doctor                                                         */
/* ------------------------------------------------------------------ */

await test('doctor (direct call): this repo passes Node version, has local framework, src/pages/ exists', () => {
  const result = runDoctor(repoRoot);
  const byMessage = result.checks.map((c) => c.message);
  assert.ok(byMessage.some((m) => m.startsWith('Node.js')));
  const nodeCheck = result.checks.find((c) => c.message.startsWith('Node.js'))!;
  assert.equal(nodeCheck.ok, true, 'this repo\'s Node version should be >= 20');

  const pagesCheck = result.checks.find((c) => c.message.includes('src/pages/'))!;
  assert.equal(pagesCheck.ok, true);

  const depCheck = result.checks.find((c) => c.message.includes('"@monsef-nbj/najm" dependency'))!;
  assert.equal(depCheck.ok, true, 'local framework source should satisfy the dependency check for this monorepo');
});

await test('doctor (direct call): dynamic routes are reported informationally, not as a failure', () => {
  const result = runDoctor(repoRoot);
  const dynamicCheck = result.checks.find((c) => c.message.includes('dynamic route'));
  assert.ok(dynamicCheck, 'expected an informational dynamic-route check given src/pages/greet/[name].najm exists');
  assert.equal(dynamicCheck!.info, true);
  assert.equal(dynamicCheck!.ok, true);
});

await test('doctor (REAL subprocess): `tsx cli/najm.ts doctor` against this repo exits 0 and prints the checklist', () => {
  const { stdout, status } = runCli(['doctor']);
  assert.equal(status, 0, `doctor should exit 0 for this repo's real state; stdout:\n${stdout}`);
  assert.match(stdout, /Node\.js .* \(>= 20 required\)/);
  assert.match(stdout, /src\/pages\/ exists/);
  assert.match(stdout, /dynamic route\(s\) excluded from static generation \(expected/);
});

/* ------------------------------------------------------------------ */
/* najm lint                                                           */
/* ------------------------------------------------------------------ */

const TYPO_FIXTURE = `<script>
  const count = 0;
</script>

<template>
  <main>
    <h1>Count: {cuont}</h1>
  </main>
</template>
`;

const CLEAN_FIXTURE = `<script>
  const count = 0;
</script>

<template>
  <main>
    <h1>Count: {count}</h1>
  </main>
</template>
`;

await test('lint (direct call): a real typo ({cuont}) produces exactly one correctly-formatted diagnostic', () => {
  const diagnostics = lintSource('fixture.najm', TYPO_FIXTURE);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /`cuont` is not defined/);
  assert.equal(diagnostics[0].line, 7);
});

await test('lint (direct call): a clean file produces zero diagnostics', () => {
  const diagnostics = lintSource('fixture.najm', CLEAN_FIXTURE);
  assert.deepEqual(diagnostics, []);
});

await test('lint (direct call): src/ in this repo is clean today (zero diagnostics)', () => {
  const diagnostics = lintDir(path.join(repoRoot, 'src'));
  assert.deepEqual(diagnostics, [], `expected src/ to lint clean, got: ${JSON.stringify(diagnostics)}`);
});

await test('lint (REAL subprocess): a fixture with a real typo reports file:line and exits 1', () => {
  const tmpSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-cli-lint-test-'));
  const savedSrcDir = path.join(repoRoot, 'src');
  // lintDir() is always called against THIS repo's src/ by the CLI
  // (najm lint has no target-dir flag per RFC-0011's scope) — so to
  // exercise the real subprocess against a deliberate typo without
  // corrupting the repo's own fixtures, write a throwaway file INTO
  // src/pages/ under a dedicated subdirectory, then remove it
  // afterwards, mirroring tests/test-build.ts's & test-router.ts's
  // "throwaway tree, cleaned up" discipline.
  const throwawayDir = path.join(savedSrcDir, 'pages', '.cli-lint-test-tmp');
  fs.mkdirSync(throwawayDir, { recursive: true });
  const typoFile = path.join(throwawayDir, 'typo.najm');
  fs.writeFileSync(typoFile, TYPO_FIXTURE, 'utf8');
  try {
    const { stdout, status } = runCli(['lint']);
    assert.equal(status, 1, `lint should exit 1 when a typo fixture is present; stdout:\n${stdout}`);
    const relPath = path.relative(repoRoot, typoFile).split(path.sep).join('/');
    assert.ok(stdout.includes(`${relPath}:7`), `expected diagnostic line to reference ${relPath}:7, got:\n${stdout}`);
    assert.match(stdout, /`cuont` is not defined/);
  } finally {
    fs.rmSync(throwawayDir, { recursive: true, force: true });
    fs.rmSync(tmpSrc, { recursive: true, force: true });
  }
});

await test('lint (REAL subprocess): this repo\'s real src/ (no typo fixture present) exits 0 with "no problems found"', () => {
  const { stdout, status } = runCli(['lint']);
  assert.equal(status, 0, `stdout:\n${stdout}`);
  assert.match(stdout, /no problems found/);
});

/* ------------------------------------------------------------------ */
/* najm build — wrapper equivalence, real subprocess                   */
/* ------------------------------------------------------------------ */

await test('build (REAL subprocess): `tsx cli/najm.ts build` invokes server/build.ts and produces the same dist/manifest.json shape as `npm run build`', () => {
  // A real build (not a structural-only check) — this is the one
  // subcommand where "the wrapper really spawns server/build.ts" is
  // worth proving with the actual, slower end-to-end run, the same
  // cost tests/test-build.ts already pays for the npm-script path.
  const { status, stdout } = runCli(['build'], { timeout: 120_000 });
  assert.equal(status, 0, `najm build should exit 0; stdout:\n${stdout}`);
  assert.match(stdout, /najm build complete — dist\/manifest\.json written/);

  const manifestPath = path.join(repoRoot, 'dist', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0);
  const about = manifest.routes.find((r: any) => r.pathname === '/about');
  assert.ok(about, '/about should be in the manifest, same as npm run build produces');
  assert.equal(about.type, 'static');
});

/* ------------------------------------------------------------------ */
/* najm dev / najm preview — --port -> PORT env plumbing, real process */
/* ------------------------------------------------------------------ */

function httpGet(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timed out'));
    });
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = once(child, 'exit');
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(-child.pid, 'SIGTERM');
  }
  await exited;
}

async function verifyPortWrapper(command: 'dev' | 'preview', port: number): Promise<void> {
  const child = spawn(process.execPath, [tsxCli, cliEntry, command, '--port', String(port)], {
    cwd: repoRoot,
    stdio: 'pipe',
    detached: process.platform !== 'win32',
  });
  try {
    // Poll until the server accepts connections (or fail after ~15s) —
    // dev mode spins up a Vite middleware server first, which takes a
    // moment longer than preview's plain static server.
    const deadline = Date.now() + 15_000;
    let status = 0;
    for (;;) {
      try {
        status = await httpGet(`http://localhost:${port}/about`, 2_000);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`${command} server on port ${port} never became reachable`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    assert.equal(status, 200, `expected 200 from ${command} server's /about route on the --port-selected port`);
  } finally {
    await terminateProcessTree(child);
  }
}

await test('dev (REAL subprocess): `najm dev --port <n>` binds server/dev.ts to that exact port (proves --port -> PORT plumbing)', async () => {
  await verifyPortWrapper('dev', 4401);
});

await test('preview (REAL subprocess): `najm preview --port <n>` binds server/serve.ts to that exact port, serving the dist/ this suite just built', async () => {
  await verifyPortWrapper('preview', 4402);
});

/* ------------------------------------------------------------------ */
/* create-najm-app                                                     */
/* ------------------------------------------------------------------ */

await test('create-najm-app (direct call): scaffolds the expected structure into a real temp directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-create-app-test-'));
  const target = path.join(tmp, 'my-app');
  try {
    const result = scaffoldApp(target);
    const expected = [
      'src/pages/layout.najm',
      'src/pages/index.najm',
      path.join('src', 'pages', 'greet', '[name].najm'),
      'src/components/Counter.najm',
      'tests/test-example.ts',
      'package.json',
      '.gitignore',
    ].map((p) => p.split(path.sep).join('/'));
    assert.deepEqual(result.filesWritten.slice().sort(), expected.sort());

    for (const rel of expected) {
      assert.ok(fs.existsSync(path.join(target, rel)), `${rel} should have been written`);
    }

    // No Vitest config, per RFC-0011's explicit scope decision.
    assert.ok(!fs.existsSync(path.join(target, 'vitest.config.ts')));
    assert.ok(!fs.existsSync(path.join(target, 'vitest.config.js')));

    // The example test is node:assert style, not a Vitest import.
    const testFile = fs.readFileSync(path.join(target, 'tests', 'test-example.ts'), 'utf8');
    assert.match(testFile, /from 'node:assert\/strict'/);
    assert.doesNotMatch(testFile, /vitest/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test('create-najm-app: generated package.json is valid JSON and references published package names, not this repo\'s local aliases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-create-app-test-'));
  const target = path.join(tmp, 'my-app');
  try {
    scaffoldApp(target);
    const raw = fs.readFileSync(path.join(target, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw); // throws if not valid JSON
    assert.ok(pkg.dependencies['@monsef-nbj/najm'], 'expected a scoped najm dependency');
    assert.ok(pkg.dependencies['@monsef-nbj/najm-compiler'], 'expected a scoped compiler dependency');
    assert.ok(pkg.dependencies['@monsef-nbj/najm-router'], 'expected a scoped router dependency');

    const wholeTree = [
      raw,
      fs.readFileSync(path.join(target, 'src', 'pages', 'index.najm'), 'utf8'),
      fs.readFileSync(path.join(target, 'src', 'components', 'Counter.najm'), 'utf8'),
    ].join('\n');
    // `@monsef-nbj/najm/core` is the published runtime subpath (its
    // "./core" export) — the exact specifier the compiler emits — so a
    // generated project referencing it is correct, not a leaked repo
    // alias. (Pre-rebrand, "mono/core" was repo-local-only and the
    // published name was going to differ; that premise died when the
    // core package became bare `najm` with a ./core export.) What must
    // still never leak is the true repo-internal legacy alias:
    assert.doesNotMatch(wholeTree, /@najm\/runtime/, 'generated project should not reference the local "@najm/runtime" alias');
    // ...or any relative path escaping into this repo's own tree:
    assert.doesNotMatch(wholeTree, /\.\.\/(runtime|compiler|router|server)\//, 'generated project should not reach into the framework repo by relative path');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test('create-najm-app (REAL subprocess): `tsx cli/najm.ts create-najm-app <dir>` scaffolds via the real binary entry point', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-create-app-cli-test-'));
  const target = path.join(tmp, 'cli-scaffolded-app');
  try {
    const { status, stdout } = runCli(['create-najm-app', target]);
    assert.equal(status, 0, `stdout:\n${stdout}`);
    assert.ok(fs.existsSync(path.join(target, 'package.json')));
    assert.ok(fs.existsSync(path.join(target, 'src', 'pages', 'index.najm')));
    assert.ok(fs.existsSync(path.join(target, 'src', 'pages', 'greet', '[name].najm')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Unknown command / usage                                             */
/* ------------------------------------------------------------------ */

await test('najm (no command / unknown command) prints usage and exits non-zero', () => {
  const noCommand = runCli([]);
  assert.notEqual(noCommand.status, 0);
  assert.match(noCommand.stdout, /usage: najm <command>/);

  const unknown = runCli(['bogus-command']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown command "bogus-command"/);
});

console.log(`\ncli: all ${passed} tests passed`);
