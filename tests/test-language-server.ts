/**
 * Language-server test suite (RFC-0012) — `language-server/`.
 *
 * Proves the LSP-SPECIFIC layer: position mapping (offset <-> LSP
 * `{line, character}`, `Diagnostic.expr`/`.identifier` -> a real
 * document `Range`), the two `.najm` file styles' extraction paths
 * (functional-component `return { template }` vs. legacy SFC
 * `<script>/<template>`), go-to-definition's LSP-side re-scan, and
 * completion's two contexts (expression scope + each-block loop-var
 * cursor-position awareness, tag-position component/directive list).
 *
 * Does NOT re-prove `analyzeSemantics()`/`scanDeclarations()`/
 * `resolveExprDeps()` themselves — that's `tests/test-semantics.ts`'s
 * job (20 cases, already covering declaration classification, deps
 * resolution, loop-variable scoping, and the dual-mode non-throwing
 * design). Every provider here is a thin, un-forked adapter over those
 * real compiler functions (RFC-0012's non-negotiable constraint — see
 * `language-server/extract.ts`'s doc comment) — these tests exercise
 * that adapter layer, not the compiler logic underneath it.
 */
import assert from 'node:assert/strict';
import { getDiagnostics } from '../language-server/diagnostics';
import { getDefinition, identifierAtPosition } from '../language-server/definition';
import { getCompletions, classifyContext } from '../language-server/completion';
import { offsetToPosition } from '../language-server/positions';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Convenience: LSP Position for the Nth occurrence (0-based) of `needle` in `text`, offset by `within`. */
function posOf(text: string, needle: string, withinNeedleOffset = 0, occurrence = 0): { line: number; character: number } {
  let from = 0;
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = text.indexOf(needle, from);
    if (idx < 0) throw new Error(`smoke: "${needle}" occurrence ${occurrence} not found`);
    from = idx + 1;
  }
  return offsetToPosition(text, idx + withinNeedleOffset);
}

/* -------------------------------------------------------------------- */
/* Diagnostics: functional-component-style fixture, unresolved reference */
/* -------------------------------------------------------------------- */

const FUNCTIONAL_TYPO = `import TodoList from "../components/TodoList.najm";

export default function HomePage(props = {}) {
  const count = signal(0);
  const pillars = [1, 2, 3];

  return {
    template: \`
      <main>
        <h1>Count: {cuont}</h1>
        <ul>
          {#each pillars as p, i}
            <li>{p} #{i}</li>
          {/each}
        </ul>
        <TodoList client:load />
      </main>
    \`,
  };
}
`;

test('functional-component fixture: an unresolved identifier ({cuont}, a typo of count) produces exactly one diagnostic with a range pointing at the real substring', () => {
  const diags = getDiagnostics('fixture.najm', FUNCTIONAL_TYPO);
  assert.equal(diags.length, 1);
  assert.match(diags[0].message, /cuont.*is not defined/);

  const { range } = diags[0];
  const lines = FUNCTIONAL_TYPO.split('\n');
  const lineText = lines[range.start.line];
  const substring = lineText.slice(range.start.character, range.end.character);
  assert.equal(substring, 'cuont', `range should point at "cuont" in line ${JSON.stringify(lineText)}, got ${JSON.stringify(substring)}`);
});

/* -------------------------------------------------------------------- */
/* Diagnostics: SFC-style fixture (about.najm-shaped), unresolved ref    */
/* -------------------------------------------------------------------- */

const SFC_TYPO = `<script>
  const facts = [
    "Every page is server-rendered HTML first.",
    "This page has no islands.",
  ];
</script>

<template>
  <main>
    <h1>About Najm</h1>
    <ul>
      {#each facts as fact}
        <li>{fcat}</li>
      {/each}
    </ul>
  </main>
</template>

<style>
  main { max-width: 42rem; }
</style>
`;

test('SFC-style fixture (about.najm-shaped): an unresolved identifier ({fcat}, a typo of fact) produces one diagnostic with a correct range', () => {
  const diags = getDiagnostics('about-fixture.najm', SFC_TYPO);
  assert.equal(diags.length, 1);
  assert.match(diags[0].message, /fcat.*is not defined/);

  const { range } = diags[0];
  const lines = SFC_TYPO.split('\n');
  const lineText = lines[range.start.line];
  const substring = lineText.slice(range.start.character, range.end.character);
  assert.equal(substring, 'fcat');
  assert.ok(lineText.includes('<li>{fcat}</li>'), `expected the typo'd line, got ${JSON.stringify(lineText)}`);
});

/* -------------------------------------------------------------------- */
/* Diagnostics: clean fixtures produce zero diagnostics                  */
/* -------------------------------------------------------------------- */

test('a clean functional-component fixture (every identifier resolves) produces zero diagnostics', () => {
  const clean = FUNCTIONAL_TYPO.replace('{cuont}', '{count}');
  assert.deepEqual(getDiagnostics('clean.najm', clean), []);
});

test('a clean SFC fixture (every identifier resolves) produces zero diagnostics', () => {
  const clean = SFC_TYPO.replace('{fcat}', '{fact}');
  assert.deepEqual(getDiagnostics('about-clean.najm', clean), []);
});

/* -------------------------------------------------------------------- */
/* Go-to-definition: resolves to the correct declaration line            */
/* -------------------------------------------------------------------- */

test('go-to-definition: cursor on a signal usage ({count}) resolves to the line where `const count = signal(...)` was declared', () => {
  const clean = FUNCTIONAL_TYPO.replace('{cuont}', '{count}');
  const usagePos = posOf(clean, 'Count: {count}', 'Count: {'.length);
  const def = getDefinition('clean.najm', clean, usagePos);
  assert.ok(def, 'expected a definition location');
  const declLine = clean.split('\n')[def!.range.start.line];
  assert.match(declLine, /const count = signal\(0\);/);
});

test('go-to-definition: cursor on an identifier with no resolution (a function name, not in scope.decls) returns null, does not throw', () => {
  const pos = posOf(FUNCTIONAL_TYPO, 'HomePage');
  assert.doesNotThrow(() => {
    const def = getDefinition('fixture.najm', FUNCTIONAL_TYPO, pos);
    assert.equal(def, null);
  });
});

test('identifierAtPosition finds the whole identifier under the cursor, including mid-word offsets', () => {
  assert.equal(identifierAtPosition('const count = 1;', { line: 0, character: 8 }), 'count');
});

/* -------------------------------------------------------------------- */
/* Completion inside {...}: scope + in-scope each-block loop variables   */
/* -------------------------------------------------------------------- */

test('completion inside {...}: includes declared signals/bindings/functions and propsParam', () => {
  const insidePos = posOf(FUNCTIONAL_TYPO, '#{i}', 2);
  const items = getCompletions('fixture.najm', FUNCTIONAL_TYPO, insidePos).map((c) => c.label);
  assert.ok(items.includes('count'), `expected "count" in ${JSON.stringify(items)}`);
  assert.ok(items.includes('pillars'), `expected "pillars" in ${JSON.stringify(items)}`);
  assert.ok(items.includes('props'), `expected "props" in ${JSON.stringify(items)}`);
});

test('completion inside {...}: INCLUDES each-block loop variables (p, i) when the cursor is inside that each-block\'s body', () => {
  const insideEachPos = posOf(FUNCTIONAL_TYPO, '#{i}', 2);
  const items = getCompletions('fixture.najm', FUNCTIONAL_TYPO, insideEachPos).map((c) => c.label);
  assert.ok(items.includes('p'), `expected loop var "p" in ${JSON.stringify(items)}`);
  assert.ok(items.includes('i'), `expected loop var "i" in ${JSON.stringify(items)}`);
});

test('completion inside {...}: EXCLUDES each-block loop variables (p, i) when the cursor is OUTSIDE that each-block', () => {
  const outsidePos = posOf(FUNCTIONAL_TYPO, 'Count: {cuont}', 'Count: {'.length);
  const items = getCompletions('fixture.najm', FUNCTIONAL_TYPO, outsidePos).map((c) => c.label);
  assert.ok(!items.includes('p'), `did not expect loop var "p" outside the each-block, got ${JSON.stringify(items)}`);
  assert.ok(!items.includes('i'), `did not expect loop var "i" outside the each-block, got ${JSON.stringify(items)}`);
});

/* -------------------------------------------------------------------- */
/* Completion in tag position: componentNames + fixed directive set      */
/* -------------------------------------------------------------------- */

test('completion in tag position (<|): returns imported component names plus exactly client:load, client:visible, bind:value, bind:checked — and NOT client:idle', () => {
  const tagPos = posOf(FUNCTIONAL_TYPO, '<TodoList', 1);
  const items = getCompletions('fixture.najm', FUNCTIONAL_TYPO, tagPos).map((c) => c.label);
  assert.ok(items.includes('TodoList'), `expected imported component "TodoList" in ${JSON.stringify(items)}`);
  assert.ok(items.includes('client:load'));
  assert.ok(items.includes('client:visible'));
  assert.ok(items.includes('bind:value'));
  assert.ok(items.includes('bind:checked'));
  assert.ok(!items.includes('client:idle'), 'client:idle is not implemented (RFC-0007) and must not be offered');
});

test('classifyContext correctly distinguishes tag position from expression position around a preceding {/each}', () => {
  // Regression case: a `}` from an earlier {/each} must not be mistaken
  // for an unclosed `{` when the cursor is later in a tag position.
  const tagOffset = FUNCTIONAL_TYPO.indexOf('<TodoList') + 1;
  assert.equal(classifyContext(FUNCTIONAL_TYPO, tagOffset), 'tag');
});

/* -------------------------------------------------------------------- */
/* Known false positive: destructured prop parameters (honestly carried  */
/* over from compiler/semantics.ts, not fixed here)                      */
/* -------------------------------------------------------------------- */

test('the destructured-prop-parameter false positive is reproduced (not fixed): the LSP surfaces the same diagnostic analyzeSemantics() would, not a crash or different behavior', () => {
  const source = `export default function Fixture({ initial }) {
  return {
    template: \`<p>{initial}</p>\`,
  };
}
`;
  const diags = getDiagnostics('destructured.najm', source);
  // Known gap (compiler/semantics.ts's documented scanning boundary):
  // destructured parameter shapes are NOT caught, so `initial` is
  // incorrectly flagged as unresolved. This test documents that the LSP
  // inherits this exact behavior rather than diverging from it (e.g. by
  // crashing, or by silently suppressing the false positive).
  assert.equal(diags.length, 1);
  assert.match(diags[0].message, /initial.*is not defined/);
  const lineText = source.split('\n')[diags[0].range.start.line];
  const substring = lineText.slice(diags[0].range.start.character, diags[0].range.end.character);
  assert.equal(substring, 'initial');
});

/* -------------------------------------------------------------------- */
/* Never throws on malformed/unextractable documents                     */
/* -------------------------------------------------------------------- */

test('getDiagnostics/getDefinition/getCompletions never throw on a document with no extractable template', () => {
  const garbage = 'export default function Broken() { return {}; }';
  assert.doesNotThrow(() => getDiagnostics('garbage.najm', garbage));
  assert.doesNotThrow(() => getDefinition('garbage.najm', garbage, { line: 0, character: 0 }));
  assert.doesNotThrow(() => getCompletions('garbage.najm', garbage, { line: 0, character: 0 }));
  assert.deepEqual(getDiagnostics('garbage.najm', garbage), []);
  assert.equal(getDefinition('garbage.najm', garbage, { line: 0, character: 0 }), null);
  assert.deepEqual(getCompletions('garbage.najm', garbage, { line: 0, character: 0 }), []);
});

console.log(`\nlanguage-server: all ${passed} tests passed`);
