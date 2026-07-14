/**
 * Suite-registration test suite — RFC-0015's Verification gate.
 *
 * RFC-0015 formalizes the existing tests/ convention (one file per
 * subsystem, sequentially `&&`-chained into package.json's `test`
 * script, no glob discovery). The one real gap that convention has: a
 * new tests/test-*.ts file that's never added to that chain silently
 * never runs — no error, no warning, just a suite that exists on disk
 * and reports nothing. This script closes that gap the same way
 * test-runtime-boundary.ts closes RFC-0002's import-boundary gap: pure
 * static analysis, no type-checker, no bundler, checked as part of the
 * suite chain itself (so a future missing-registration bug is caught by
 * `npm test`, not just by someone happening to notice).
 *
 * This file is deliberately the LAST assertion in package.json's chain
 * (see the ordering note in Verification) — a file added after this one
 * would still be caught on the NEXT run, since the check reads the
 * script string itself, not "what already ran before this point."
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const testsDir = path.resolve(root, 'tests');

function suiteFiles(): string[] {
  return fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

function testScript(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const script = pkg.scripts?.test;
  if (typeof script !== 'string') {
    throw new Error('[test-suite-registration] package.json has no "test" script to check');
  }
  return script;
}

test('sanity: tests/ contains suite files to check', () => {
  assert.ok(suiteFiles().length > 0);
});

test('every tests/*.ts file is referenced in package.json\'s "test" script', () => {
  const script = testScript();
  const missing = suiteFiles().filter((f) => !script.includes(`tests/${f}`));
  assert.deepEqual(
    missing,
    [],
    `these suite files exist but are never run by "npm test": ${missing.join(', ')} — ` +
      `add "tsx tests/<file>" to package.json's test script`
  );
});

test('the "test" script does not reference a suite file that no longer exists', () => {
  const script = testScript();
  const referenced = [...script.matchAll(/tests\/([\w.-]+\.ts)/g)].map((m) => m[1]);
  const onDisk = new Set(suiteFiles());
  const dangling = referenced.filter((f) => !onDisk.has(f));
  assert.deepEqual(
    dangling,
    [],
    `"test" script references file(s) that don't exist in tests/: ${dangling.join(', ')}`
  );
});

console.log(`\nsuite registration: all ${passed} tests passed`);
