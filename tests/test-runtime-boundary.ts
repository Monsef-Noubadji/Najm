/**
 * Runtime boundary test suite — RFC-0002's Verification gate.
 * Statically scans every .ts file under runtime/ for import/require
 * specifiers and asserts two things the RFC's package-boundary design
 * depends on:
 *
 *  1. najm never imports a UI framework (react, vue, angular, ...).
 *     This is the concrete, automatable form of "cross-framework interop
 *     happens at the Web Component boundary, not inside the runtime"
 *     (RFC-0002's "Cross-framework interop" section) — the Beta prototype
 *     violated exactly this by having framework/interop/{react,vue}.ts
 *     implement Najm's internal ComponentView ABI directly; that code is
 *     archived at legacy/framework/interop/ and must never come back.
 *  2. najm imports nothing outside itself except the JS/DOM standard
 *     library — no reaching into compiler/, router/, or server/. This is
 *     RFC-0002's "No package above imports another peer package. najm
 *     imports nothing outside the JS/DOM standard library" line, checked
 *     from the core's own side (peer packages are free to import
 *     najm; najm must never import them back).
 *
 * Both checks are pure static analysis over import specifiers — no
 * type-checker, no bundler — so this stays fast and dependency-free,
 * matching the rest of tests/.
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
const runtimeDir = path.resolve(here, '..', 'runtime');

/** Every .ts file under runtime/, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pulls import/require specifiers out of a TS source file via regex, not a
 * real parser. Good enough here: this only needs to catch string-literal
 * module specifiers in `import ... from '...'`, bare `import '...'`,
 * `export ... from '...'`, and `require('...')` — every form actually used
 * in runtime/ (verified against the current tree) and the only forms the
 * compiler/bundler resolve statically. Dynamic, computed specifiers
 * (`import(someVariable)`) would not be caught, but none exist in
 * runtime/ today; this is a static-analysis gate, not a full type-check.
 */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]*?\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      specifiers.push(m[1]);
    }
  }
  return specifiers;
}

// Known UI framework / component runtime packages. If najm ever
// imports one of these, the "runtime hosts another framework's
// reconciler" mistake from Beta has come back — see the file header and
// RFC-0002's "Cross-framework interop" section.
const FRAMEWORK_PACKAGES = [
  'react', // Beta's framework/interop/react.ts implemented ComponentView directly — the exact mistake this gate exists to catch
  'react-dom', // React's hydration/reconciler entry point; same violation via the render side
  'vue', // Beta's framework/interop/vue.ts counterpart to react.ts
  '@vue/runtime-core',
  '@vue/runtime-dom',
  '@angular/core', // named explicitly in RFC-0002's Verification bullet
  '@angular/common',
  'svelte', // another component-authoring runtime with its own reconciliation/update model
  'solid-js', // signals-based like Najm, but still a separate component runtime — same boundary applies
  'preact', // React-API-compatible but still a foreign reconciler
  'lit', // Web Component authoring library with its own reactive update scheduler
];

function isFrameworkSpecifier(specifier: string): boolean {
  return FRAMEWORK_PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`)
  );
}

// A specifier "reaches outside runtime/" if it's a relative path that
// resolves above runtimeDir, or a bare specifier that isn't a Node
// builtin (optionally 'node:'-prefixed) and isn't a type-only ambient
// global (DOM lib types need no import at all, so nothing to allow-list
// there). Anything left over would be a peer package (compiler/, router/,
// server/) or a third-party npm dependency — both forbidden by RFC-0002.
const NODE_BUILTINS = new Set(
  // Values actually usable as bare-specifier imports in this codebase's
  // Node target (ES2022 / Node 18+), without the 'node:' prefix.
  [
    'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram',
    'dns', 'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path',
    'perf_hooks', 'process', 'querystring', 'readline', 'stream',
    'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
    'worker_threads', 'zlib',
  ]
);

function isAllowedStdlibSpecifier(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return NODE_BUILTINS.has(specifier);
}

function resolvesOutsideRuntime(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false; // not a relative import
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const rel = path.relative(runtimeDir, resolved);
  return rel.startsWith('..');
}

const runtimeFiles = walk(runtimeDir);

test('runtime/ contains .ts files to scan (sanity check the walk itself works)', () => {
  assert.ok(runtimeFiles.length > 0, 'expected at least one .ts file under runtime/');
});

test('najm has zero imports of react, vue, @angular/*, or any other UI framework', () => {
  const violations: string[] = [];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of extractSpecifiers(source)) {
      if (isFrameworkSpecifier(specifier)) {
        violations.push(`${path.relative(runtimeDir, file)}: imports "${specifier}"`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `runtime/ must never import a UI framework (RFC-0002's Cross-framework ` +
      `interop boundary) — found:\n${violations.join('\n')}`
  );
});

test('najm imports nothing outside runtime/ except the JS/DOM standard library', () => {
  const violations: string[] = [];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of extractSpecifiers(source)) {
      if (resolvesOutsideRuntime(file, specifier)) {
        violations.push(
          `${path.relative(runtimeDir, file)}: relative import "${specifier}" escapes runtime/`
        );
        continue;
      }
      if (!specifier.startsWith('.') && !isAllowedStdlibSpecifier(specifier)) {
        violations.push(
          `${path.relative(runtimeDir, file)}: bare import "${specifier}" is neither a ` +
            `relative runtime/ import nor a recognized Node stdlib module`
        );
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `runtime/ must import nothing outside itself but the JS/DOM standard ` +
      `library (RFC-0002's package boundary: "No package above imports ` +
      `another peer package. najm imports nothing outside the JS/DOM ` +
      `standard library.") — found:\n${violations.join('\n')}`
  );
});

console.log(`\nruntime boundary: all ${passed} tests passed`);
