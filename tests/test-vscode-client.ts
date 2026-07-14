/**
 * VS Code extension client-wiring test suite (RFC-0013).
 *
 * IMPORTANT SCOPE NOTE — read before trusting what "passing" means here:
 * this suite does NOT load a real VS Code instance and does NOT prove
 * `vscode/dist/extension.js`'s `activate()` actually spawns the language
 * server and gets diagnostics/completion working end to end inside VS
 * Code. That would require the `@vscode/test-electron` integration
 * harness, deliberately out of scope for this RFC (see the RFC text and
 * this session's report). What this suite DOES verify, all by static
 * inspection of files on disk plus one real `tsc` build invocation, is
 * that the WIRING is structurally correct:
 *
 *   - `vscode/package.json` declares the right `main`/`activationEvents`
 *     and still declares the pre-existing syntax-highlighting
 *     `contributes` block unchanged.
 *   - `vscode/src/extension.ts`'s source references the correct LSP
 *     server entry point path (`language-server/server.ts`) and the
 *     correct `documentSelector` (`{ scheme: 'file', language: 'najm' }`)
 *     RFC-0013 specifies.
 *   - The build step (`tsc -p vscode/tsconfig.json`) actually produces
 *     valid, `require()`-able JS with `activate`/`deactivate` function
 *     exports of the right arity.
 *
 * This is the same "the plumbing is structurally correct, not that VS
 * Code actually loaded it" distinction `language-server/server.ts`'s own
 * header comment draws about its own test coverage.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const vscodeDir = path.join(root, 'vscode');

/* -------------------------------------------------------------------- */
/* package.json shape                                                    */
/* -------------------------------------------------------------------- */

function readPkg(): any {
  return JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf8'));
}

test('vscode/package.json has "main" pointing at compiled dist output', () => {
  const pkg = readPkg();
  assert.equal(pkg.main, './dist/extension.js');
});

test('vscode/package.json declares onLanguage:najm activation', () => {
  const pkg = readPkg();
  assert.ok(Array.isArray(pkg.activationEvents));
  assert.ok(pkg.activationEvents.includes('onLanguage:najm'));
});

test('vscode/package.json depends on vscode-languageclient', () => {
  const pkg = readPkg();
  assert.ok(
    pkg.dependencies && typeof pkg.dependencies['vscode-languageclient'] === 'string',
    'expected "vscode-languageclient" in vscode/package.json\'s dependencies'
  );
});

test('vscode/package.json has a build script that runs tsc', () => {
  const pkg = readPkg();
  assert.ok(typeof pkg.scripts?.build === 'string' && pkg.scripts.build.includes('tsc'));
});

test('pre-existing syntax-highlighting contributes block is untouched', () => {
  const pkg = readPkg();
  assert.equal(pkg.contributes.languages[0].id, 'najm');
  assert.equal(pkg.contributes.grammars[0].scopeName, 'source.najm');
  assert.equal(pkg.contributes.iconThemes[0].id, 'najm-icons');
});

/* -------------------------------------------------------------------- */
/* extension.ts source references                                       */
/* -------------------------------------------------------------------- */

function extensionSource(): string {
  return fs.readFileSync(path.join(vscodeDir, 'src', 'extension.ts'), 'utf8');
}

test('extension.ts imports LanguageClient from vscode-languageclient/node', () => {
  const src = extensionSource();
  assert.match(src, /from ['"]vscode-languageclient\/node['"]/);
  assert.match(src, /LanguageClient/);
});

test('extension.ts references language-server/server.ts as the spawned server module', () => {
  const src = extensionSource();
  assert.match(src, /language-server['"]?,?\s*['"]?server\.ts|'language-server', 'server\.ts'|language-server\/server\.ts/);
});

test('extension.ts registers the LSP client for the najm documentSelector', () => {
  const src = extensionSource();
  assert.match(src, /scheme:\s*['"]file['"]/);
  assert.match(src, /language:\s*['"]najm['"]/);
});

test('extension.ts exports activate() and deactivate()', () => {
  const src = extensionSource();
  assert.match(src, /export function activate\(/);
  assert.match(src, /export function deactivate\(/);
});

test('extension.ts documents the tsx/packaging gap rather than silently assuming a bundled server', () => {
  const src = extensionSource();
  assert.match(src, /KNOWN PACKAGING GAP/i);
});

/* -------------------------------------------------------------------- */
/* Build step: tsc actually produces valid, loadable JS                  */
/* -------------------------------------------------------------------- */

test('tsc -p vscode/tsconfig.json builds extension.ts to dist/extension.js', () => {
  // shell: true — on Windows, npx resolves to npx.cmd, which
  // execFileSync cannot exec directly without going through a shell.
  execFileSync('npx tsc -p ./tsconfig.json', { cwd: vscodeDir, stdio: 'pipe', shell: true });
  assert.ok(fs.existsSync(path.join(vscodeDir, 'dist', 'extension.js')));
});

test('compiled dist/extension.js require()s without throwing before hitting the vscode-host-only boundary, and exports activate/deactivate of the right arity', () => {
  // The extension host injects a virtual `vscode` module at runtime that
  // does not exist under plain `node`, so a full `require()` here cannot
  // succeed the way it would inside VS Code — that gap is exactly what's
  // NOT verified by this suite (see header comment). What CAN be checked
  // without a real VS Code instance: our own compiled code runs its
  // top-level module body and gets as far as requiring
  // `vscode-languageclient`, which is the expected failure boundary
  // (vscode-languageclient itself requiring the real `vscode` API) — not
  // a syntax error, not a throw inside our own extension.ts output.
  const distPath = path.join(vscodeDir, 'dist', 'extension.js');
  try {
    delete require.cache[require.resolve(distPath)];
    const mod = require(distPath);
    // If `vscode` somehow resolved (e.g. real VS Code host), the exports
    // must still have the right shape.
    assert.equal(typeof mod.activate, 'function');
    assert.equal(typeof mod.deactivate, 'function');
    assert.equal(mod.activate.length, 1);
  } catch (err: any) {
    assert.equal(
      err.code,
      'MODULE_NOT_FOUND',
      `expected extension.js to fail only at the vscode-host boundary (MODULE_NOT_FOUND for 'vscode'), got: ${err.message}`
    );
    assert.ok(
      /vscode-languageclient/.test(String(err.requireStack?.[0] ?? '')),
      `expected the failure to originate inside vscode-languageclient requiring 'vscode', got requireStack: ${JSON.stringify(err.requireStack)}`
    );
  }
});

console.log(`\nvscode client wiring: all ${passed} tests passed`);
