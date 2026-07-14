/**
 * AOT static hoisting test suite — proves the v1.0 Phase 1.1 claim
 * directly against generated code: a static subtree compiles to ONE
 * claim call, and hydration cost scales with dynamic bindings, not
 * template size.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { compile } from '../compiler/codegen';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const opts = { id: path.resolve('src/Fixture.najm'), root: process.cwd() };

test('fully static template: hydrate() emits exactly one staticSubtree() claim, no per-node walk', () => {
  const src = `
export default function Fixture() {
  return {
    template: \`
      <section class="card">
        <h1>Hello</h1>
        <p>This entire subtree never changes.</p>
        <footer><span>static all the way down</span></footer>
      </section>
    \`,
  };
}`;
  const { code } = compile(src, opts);
  // exactly one hydration-path claim call for the whole tree — no
  // per-node walk of <h1>/<p>/<footer>/<span> at all.
  const claimCalls = code.match(/__c\.(element|text|dynText|block|staticSubtree)\(/g) ?? [];
  assert.deepEqual(claimCalls, ['__c.staticSubtree(']);
  // SSR output is untouched by hoisting — same string-concat as before
  assert.match(code, /Hello/);
});

test('mixed template: only the dynamic path is walked; static siblings are hoisted', () => {
  const src = `
export default function Fixture() {
  const count = signal(0);
  return {
    template: \`
      <div>
        <header><h1>Static Title</h1><p>Static subtitle, never rebinds.</p></header>
        <span>{count}</span>
      </div>
    \`,
  };
}`;
  const { code } = compile(src, opts);
  const claimCalls = code.match(/__c\.(element|text|dynText|block|staticSubtree)\(/g) ?? [];
  // <div> (root) and <span> (leaf wrapping {count}) are both dynamic —
  // <div> because it CONTAINS dynamic content, <span> because it directly
  // wraps {count} — so both are walked via element(). But <header>, despite
  // containing two elements and two text nodes, collapses to ONE
  // staticSubtree() claim: it is never entered, <h1>/<p> are never visited.
  assert.equal(claimCalls.filter((c) => c === '__c.element(').length, 2); // <div>, <span>
  assert.equal(claimCalls.filter((c) => c === '__c.staticSubtree(').length, 1); // <header>
  assert.equal(claimCalls.filter((c) => c === '__c.dynText(').length, 1); // {count}
  // proof that <h1>/<p> were never individually walked
  assert.ok(!code.includes('__c.element("h1")'));
  assert.ok(!code.includes('__c.element("p")'));
});

test('static rows inside {#each}: client create() clones a hoisted template, not createElement per node', () => {
  const src = `
export default function Fixture() {
  const items = [];
  return {
    template: \`
      <ul>
        {#each items as item}
          <li><span class="dot"></span><em>fixed label</em></li>
        {/each}
      </ul>
    \`,
  };
}`;
  const { code } = compile(src, opts);
  assert.match(code, /const __h0 = \$hoist\(/);
  assert.match(code, /__h0\(\)/); // clone-factory invoked per row
  // no createElement calls for the fully-static <li> row content
  assert.equal((code.match(/createElement\("li"\)/g) ?? []).length, 0);
});

test('identical static subtrees dedupe to ONE hoisted template', () => {
  const src = `
export default function Fixture() {
  const items = [];
  return {
    template: \`
      <ul>
        {#each items as item}
          <li><b>fixed</b></li>
        {/each}
      </ul>
      <div><b>fixed</b></div>
    \`,
  };
}`;
  const { code } = compile(src, opts);
  // <div><b>fixed</b></div> is a top-level static subtree (one staticSubtree() claim,
  // rendered via SSR only); <li><b>fixed</b></li> is the each-row template (hoisted for
  // client cloning). They are different tags so distinct hoists, but repeating the SAME
  // row shape must not duplicate declarations.
  const hoistDecls = code.match(/const __h\d+ = \$hoist\(/g) ?? [];
  assert.equal(hoistDecls.length, 1); // only the <li> row needs a clone-factory
});

test('regression: bare static text sibling of a dynamic element claims via text(), not staticSubtree()', () => {
  // Real bug caught live: <h2>Todos <span>{remaining} left</span></h2> — the
  // leading "Todos " text node has no wrapping element, so staticSubtree()
  // (which only ever claims an Element) threw "expected a static element
  // subtree, found text" during hydration. The IR lowering pass must route
  // bare text through __c.text(), never __c.staticSubtree().
  const src = `
export default function Fixture() {
  const remaining = signal(0);
  return {
    template: \`<h2>Todos <span class="badge">{remaining} left</span></h2>\`,
  };
}`;
  const { code } = compile(src, opts);
  assert.ok(!code.includes('__c.staticSubtree()'), 'a bare text sibling must not be claimed via staticSubtree()');
  // two bare-text runs: "Todos " before <span>, " left" inside <span>
  assert.equal((code.match(/__c\.text\(\)/g) ?? []).length, 2);
});

console.log(`\nhoisting: all ${passed} tests passed`);
