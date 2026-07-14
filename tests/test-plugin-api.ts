/**
 * Plugin API test suite (RFC-0009) — proves the `NajmPlugin` contract:
 * zero-cost when absent, `transformIR` actually reaching codegen with the
 * REAL Scope, deterministic array-order execution across multiple
 * plugins, and the Markdown plugin turning real Markdown into real HTML
 * in the generated SSR output.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { compile } from '../compiler/codegen';
import type { IRNode } from '../compiler/ir';
import type { Scope } from '../compiler/semantics';
import type { NajmPlugin } from '../compiler/plugin-api';
import { markdownPlugin, markdownToHtml } from '../compiler/plugins/markdown';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const opts = { id: path.resolve('src/Fixture.najm'), root: process.cwd() };

/* ------------------------------------------------------------------ */
/* Zero-cost / no-op: opts.plugins absent → byte-identical output      */
/* ------------------------------------------------------------------ */

const FIXTURE_SRC = `
export default function Fixture() {
  const count = signal(0);
  return {
    template: \`
      <section>
        <h1>Static Title</h1>
        <p>{count.value} things, doubled: {count.value * 2}</p>
        <button (click)={count.value++}>Increment</button>
      </section>
    \`,
  };
}`;

test('opts.plugins absent produces byte-identical output to compiling with no plugins field at all', () => {
  const a = compile(FIXTURE_SRC, opts);
  const b = compile(FIXTURE_SRC, { id: opts.id, root: opts.root });
  assert.equal(a.code, b.code);
});

test('opts.plugins: [] (explicit empty array) produces byte-identical output to opts.plugins absent', () => {
  const a = compile(FIXTURE_SRC, opts);
  const b = compile(FIXTURE_SRC, { ...opts, plugins: [] });
  assert.equal(a.code, b.code);
});

/* ------------------------------------------------------------------ */
/* A minimal transformIR plugin actually runs and reaches codegen      */
/* ------------------------------------------------------------------ */

test("a plugin's transformIR runs and its injected IR node reaches the generated SSR output", () => {
  const injectPlugin: NajmPlugin = {
    name: 'inject-marker',
    transformIR(nodes) {
      return [...nodes, { kind: 'static-html', html: '<!--INJECTED-BY-PLUGIN-->', isText: false }];
    },
  };
  const { code } = compile(FIXTURE_SRC, { ...opts, plugins: [injectPlugin] });
  assert.match(code, /INJECTED-BY-PLUGIN/);
});

test('with no plugins, the injected marker never appears (sanity check for the previous test)', () => {
  const { code } = compile(FIXTURE_SRC, opts);
  assert.doesNotMatch(code, /INJECTED-BY-PLUGIN/);
});

/* ------------------------------------------------------------------ */
/* Plugin order: array order, full stop (RFC-0009's Open Questions)    */
/* ------------------------------------------------------------------ */

test('two plugins run in the exact order they are listed in opts.plugins', () => {
  const markerA: NajmPlugin = {
    name: 'marker-a',
    transformIR(nodes) {
      return [...nodes, { kind: 'static-html', html: '<!--A-->', isText: false }];
    },
  };
  const markerB: NajmPlugin = {
    name: 'marker-b',
    transformIR(nodes) {
      return [...nodes, { kind: 'static-html', html: '<!--B-->', isText: false }];
    },
  };

  const ab = compile(FIXTURE_SRC, { ...opts, plugins: [markerA, markerB] });
  const ba = compile(FIXTURE_SRC, { ...opts, plugins: [markerB, markerA] });

  const posA_ab = ab.code.indexOf('<!--A-->');
  const posB_ab = ab.code.indexOf('<!--B-->');
  assert.ok(posA_ab >= 0 && posB_ab >= 0);
  assert.ok(posA_ab < posB_ab, 'A registered before B: A\'s output must appear first');

  const posA_ba = ba.code.indexOf('<!--A-->');
  const posB_ba = ba.code.indexOf('<!--B-->');
  assert.ok(posB_ba < posA_ba, 'B registered before A: B\'s output must appear first');
});

/* ------------------------------------------------------------------ */
/* transformIR receives the REAL Scope, not a stub                     */
/* ------------------------------------------------------------------ */

test("transformIR receives the real Scope — scope.decls contains the fixture's own declared signal", () => {
  let seenScope: Scope | null = null;
  const scopeSpy: NajmPlugin = {
    name: 'scope-spy',
    transformIR(nodes, scope) {
      seenScope = scope;
      return nodes;
    },
  };
  compile(FIXTURE_SRC, { ...opts, plugins: [scopeSpy] });
  assert.ok(seenScope, 'transformIR must be called');
  const scope = seenScope as Scope;
  assert.ok(scope.decls.has('count'), 'scope.decls must contain the fixture\'s declared signal "count"');
  assert.equal(scope.decls.get('count')!.kind, 'signal');
});

test('transformIR-observed deps on a real dyn-text node resolve against the real Scope (not an approximation)', () => {
  let sawDeps: string[] | null = null;
  const depsSpy: NajmPlugin = {
    name: 'deps-spy',
    transformIR(nodes) {
      const walk = (list: IRNode[]): void => {
        for (const n of list) {
          if (n.kind === 'dyn-text' && n.expr.includes('count.value * 2')) sawDeps = n.deps;
          if (n.kind === 'element') walk(n.children);
        }
      };
      walk(nodes);
      return nodes;
    },
  };
  compile(FIXTURE_SRC, { ...opts, plugins: [depsSpy] });
  assert.deepEqual(sawDeps, ['count']);
});

/* ------------------------------------------------------------------ */
/* Markdown plugin: real Markdown → real HTML in the SSR output        */
/* ------------------------------------------------------------------ */

test('markdownToHtml converts headings, paragraphs, bold/italic, links, and lists', () => {
  const html = markdownToHtml(
    '# Hello World\n\nA paragraph with **bold** and *italic* text, and a [link](https://example.com).\n\n- one\n- two\n'
  );
  assert.match(html, /<h1>Hello World<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test("the Markdown plugin lowers {@html md('...')} into real HTML in the generated SSR output", () => {
  const src = `
export default function Post() {
  return {
    template: \`
      <article>
        {@html md('# Ship Najm|A **compiler-first** framework.')}
      </article>
    \`,
  };
}`;
  const { code } = compile(src, { ...opts, plugins: [markdownPlugin] });
  assert.match(code, /<h1>Ship Najm<\/h1>/);
  assert.match(code, /<strong>compiler-first<\/strong>/);
  // The md(...) call itself must be fully compiled away — it never
  // reaches the runtime as a function call.
  assert.doesNotMatch(code, /md\(/);
});

console.log(`\nplugin-api: all ${passed} tests passed`);
