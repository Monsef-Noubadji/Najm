/**
 * Resumability prototype test suite — v1.0 Phase 3.1.
 * Proves the mechanism end-to-end at the compiler + runtime layer
 * (no browser needed here — a live browser pass happens separately via
 * the dev server): SSR emits no closures, the QRL/graph attributes are
 * well-formed, the module-scope handler mutates the RIGHT signal when
 * resumed from serialized state alone, and the bootloader stays tiny.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compile } from '../framework/compiler/codegen';
import { isResumableSource } from '../framework/compiler/resume-codegen';
import { ResumedState } from '../framework/runtime/resume';

let passed = 0;
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function pathToFileUrl(rel: string): string {
  const abs = path.resolve(rel).replace(/\\/g, '/');
  return 'file:///' + abs;
}

const opts = { id: path.resolve('src/components/ResumableCounter.mono'), root: process.cwd() };
const source = fs.readFileSync(opts.id, 'utf8');

await runTest('isResumableSource: detects the <script resumable> marker', () => {
  assert.ok(isResumableSource(source));
  assert.ok(!isResumableSource('<script>const x = 1;</script><template><div/></template>'));
});

await runTest('compile: a resumable component has NO hydrate() export — only ssr() + module-scope handlers', () => {
  const { code } = compile(source, opts);
  assert.ok(!/export\s+function\s+hydrate/.test(code));
  assert.ok(/export\s+function\s+ssr\(/.test(code));
  // the click handler is a MODULE-SCOPE export, not a closure inline in ssr()
  assert.match(code, /export function count_click_0\(event, state\)/);
});

await runTest('compile: ssr() output embeds a serialized graph and a QRL data attribute', () => {
  const { code } = compile(source, opts);
  assert.match(code, /data-mono-resume=/);
  assert.match(code, /data-q-on-click=\\"\/src\/components\/ResumableCounter\.mono#count_click_0\\"/);
});

await runTest('compile: rejects unsupported constructs with an actionable error, not silent miscompilation', () => {
  const bad = `
<script resumable>
  import { signal } from "mono/core";
  const items = signal([]);
</script>
<template>
  <ul>{#each items as i}<li>{i}</li>{/each}</ul>
</template>`;
  assert.throws(
    () => compile(bad, { id: path.resolve('src/components/Bad.mono'), root: process.cwd() }),
    /not supported inside a client:resume component/
  );
});

await runTest('end-to-end: SSR output actually renders the initial value via real execution', async () => {
  // Compile and execute the generated module directly (write it to a real
  // temp .mjs and import THAT) to prove ssr() itself runs and produces
  // correct HTML — not just that the generated source LOOKS right as text.
  const { code } = compile(source, opts);
  const rewritten = code
    .replace("from 'mono/core'", `from ${JSON.stringify(pathToFileUrl('framework/runtime/index.ts'))}`)
    .replace("from 'mono/core/resume'", `from ${JSON.stringify(pathToFileUrl('framework/runtime/resume.ts'))}`);
  const tmpFile = path.resolve('scripts/.tmp-resumable-fixture.mjs');
  fs.writeFileSync(tmpFile, rewritten);
  let mod: any;
  try {
    mod = await import(pathToFileUrl(tmpFile) + `?t=${Date.now()}`);
  } finally {
    fs.unlinkSync(tmpFile);
  }

  const html: string = mod.ssr({});
  assert.match(html, /Resumable count: 0/);
  assert.match(html, /data-q-on-click="\/src\/components\/ResumableCounter\.mono#count_click_0"/);

  // Extract the serialized graph and prove ResumedState reconstructs the
  // EXACT signal value from data alone, then the resumed handler mutates it —
  // with NO closure from ssr() ever involved.
  const graphMatch = html.match(/data-mono-resume="([^"]*)"/);
  assert.ok(graphMatch, 'graph attribute must be present');
  const graph = JSON.parse(
    graphMatch![1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  );
  assert.deepEqual(graph, { signals: { count: 0 } });

  const state = new ResumedState(graph);
  const sig = state.signal<number>('count');
  assert.equal(sig.value, 0);
  mod.count_click_0({} as Event, state);
  assert.equal(sig.value, 1); // resumed purely from serialized data, not a closure
});

await runTest('resumed state persists across repeated interactions on the SAME instance', async () => {
  // Regression coverage for a real bug caught during browser verification:
  // the bootloader must cache one ResumedState per root element and reuse
  // it on every interaction, or each click silently resets to the
  // SSR-time snapshot instead of continuing from the previous mutation.
  const { code } = compile(source, opts);
  const rewritten = code
    .replace("from 'mono/core'", `from ${JSON.stringify(pathToFileUrl('framework/runtime/index.ts'))}`)
    .replace("from 'mono/core/resume'", `from ${JSON.stringify(pathToFileUrl('framework/runtime/resume.ts'))}`);
  const tmpFile = path.resolve('scripts/.tmp-resumable-fixture2.mjs');
  fs.writeFileSync(tmpFile, rewritten);
  let mod: any;
  try {
    mod = await import(pathToFileUrl(tmpFile) + `?t=${Date.now()}`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
  const html: string = mod.ssr({});
  const graph = JSON.parse(
    html.match(/data-mono-resume="([^"]*)"/)![1]
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  );

  // Simulate the bootloader's cache: ONE ResumedState reused across
  // three separate "interaction" invocations, exactly as
  // resumedByRoot (a WeakMap keyed by root element) does in bootloader.ts.
  const state = new ResumedState(graph);
  mod.count_click_0({} as Event, state);
  mod.count_click_0({} as Event, state);
  mod.count_click_0({} as Event, state);
  assert.equal(state.signal<number>('count').value, 3);
});

await runTest('bootloader: stripped-down logic stays near the "tiny" budget (spec: ~1kb minified)', () => {
  const src = fs.readFileSync(path.resolve('framework/runtime/bootloader.ts'), 'utf8');
  // A rough pre-minification proxy: strip imports, block/line comments,
  // blank lines, and collapse whitespace — approximates what a minifier
  // removes for free. This is NOT a real minified-byte-size gate (that
  // belongs in a build-time budget check once bundling exists); it's a
  // guard against someone accidentally growing the bootloader into a
  // mini-framework without noticing.
  const stripped = src
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(
    stripped.length < 2200,
    `bootloader.ts stripped logic is ${stripped.length} chars — investigate before it grows past the "tiny" budget`
  );
});

console.log(`\nresumability: all ${passed} tests passed`);
