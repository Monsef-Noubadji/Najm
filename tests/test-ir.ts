/**
 * IR-lowering unit tests (RFC-0003) — assert the lowering step directly:
 * a given TAST (from parse.ts, unchanged) produces the expected
 * IRNode[], independent of which codegen backend eventually consumes it.
 */
import assert from 'node:assert/strict';
import { parseTemplate } from '../compiler/parse';
import { lowerNodes } from '../compiler/ir';
import type { IRElement, IRList, IRDynText } from '../compiler/ir';
import { makeScope } from '../compiler/semantics';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const FILE = 'ir-test.najm';

test('a static element lowers to a single static-html IR node', () => {
  const ast = parseTemplate('<div class="card"><p>hello</p></div>', FILE);
  const ir = lowerNodes(ast, makeScope([]));
  assert.equal(ir.length, 1);
  assert.equal(ir[0].kind, 'static-html');
  assert.match((ir[0] as { html: string }).html, /<div class="card"><p>hello<\/p><\/div>/);
});

test('a dynamic {expr} lowers to dyn-text with correct deps', () => {
  const ast = parseTemplate('{count.value}', FILE);
  const ir = lowerNodes(ast, makeScope([['count', 'signal']]));
  assert.equal(ir.length, 1);
  assert.equal(ir[0].kind, 'dyn-text');
  const dt = ir[0] as IRDynText;
  assert.equal(dt.expr, 'count.value');
  assert.deepEqual(dt.deps, ['count']);
});

test('a dynamic {expr} with multiple free variables collects all deps', () => {
  const ast = parseTemplate('{a.value + b.value}', FILE);
  const ir = lowerNodes(ast, makeScope([['a', 'signal'], ['b', 'signal']]));
  const dt = ir[0] as IRDynText;
  assert.deepEqual(new Set(dt.deps), new Set(['a', 'b']));
});

test('an {#each} lowers to a list node', () => {
  const ast = parseTemplate('{#each items as item, i}<li>{item}</li>{/each}', FILE);
  const ir = lowerNodes(ast, makeScope([['items', 'binding']]));
  assert.equal(ir.length, 1);
  assert.equal(ir[0].kind, 'list');
  const list = ir[0] as IRList;
  assert.equal(list.itemVar, 'item');
  assert.equal(list.indexVar, 'i');
  assert.equal(list.listExpr, 'items');
  // <li>{item}</li> is dynamic (wraps a dyn-text), so it lowers to an
  // element IR node, not a static-html collapse.
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].kind, 'element');
  const li = list.body[0] as IRElement;
  assert.equal(li.tag, 'li');
  assert.equal(li.children.length, 1);
  assert.equal(li.children[0].kind, 'dyn-text');
});

test('an {#each} without an index var lowers indexVar to null', () => {
  const ast = parseTemplate('{#each items as item}<li>{item}</li>{/each}', FILE);
  const ir = lowerNodes(ast, makeScope([['items', 'binding']]));
  const list = ir[0] as IRList;
  assert.equal(list.indexVar, null);
});

test('a fully-static subtree nested inside a dynamic parent still collapses to one static-html node', () => {
  const ast = parseTemplate(
    '<div><header><h1>Static Title</h1><p>Static subtitle, never rebinds.</p></header><span>{count}</span></div>',
    FILE
  );
  const ir = lowerNodes(ast, makeScope([['count', 'signal']]));
  assert.equal(ir.length, 1);
  assert.equal(ir[0].kind, 'element'); // <div> is dynamic (contains {count})
  const div = ir[0] as IRElement;
  assert.equal(div.children.length, 2); // <header> collapsed + <span> dynamic
  assert.equal(div.children[0].kind, 'static-html'); // <header>...</header> as ONE node
  assert.match((div.children[0] as { html: string }).html, /<h1>Static Title<\/h1>/);
  assert.match((div.children[0] as { html: string }).html, /<p>Static subtitle, never rebinds\.<\/p>/);
  assert.equal(div.children[1].kind, 'element'); // <span> wraps {count}, dynamic
  const span = div.children[1] as IRElement;
  assert.equal(span.children[0].kind, 'dyn-text');
});

test('a dynamic attribute lowers to dyn-attr with deps, alongside static attrs', () => {
  const ast = parseTemplate('<input class="x" value={draft.value} />', FILE);
  const ir = lowerNodes(ast, makeScope([['draft', 'signal']]));
  assert.equal(ir[0].kind, 'element');
  const el = ir[0] as IRElement;
  assert.equal(el.attrs.length, 2);
  assert.equal(el.attrs[0].kind, 'static-attr');
  assert.equal(el.attrs[1].kind, 'dyn-attr');
  assert.deepEqual((el.attrs[1] as { deps: string[] }).deps, ['draft']);
});

test('an event attribute lowers to an event IR node, statement vs. reference distinguished', () => {
  const ast = parseTemplate('<button on:click={handleClick} (mouseenter)={hovered.value = true}>Go</button>', FILE);
  const ir = lowerNodes(ast, makeScope([['handleClick', 'function'], ['hovered', 'signal']]));
  const el = ir[0] as IRElement;
  assert.equal(el.attrs[0].kind, 'event');
  assert.equal((el.attrs[0] as { isStatement: boolean }).isStatement, false);
  assert.equal(el.attrs[1].kind, 'event');
  assert.equal((el.attrs[1] as { isStatement: boolean }).isStatement, true);
});

test('a bind: attribute lowers to two-way-bind', () => {
  const ast = parseTemplate('<input bind:value={draft} />', FILE);
  const ir = lowerNodes(ast, makeScope([['draft', 'signal']]));
  const el = ir[0] as IRElement;
  assert.equal(el.attrs[0].kind, 'two-way-bind');
  assert.equal((el.attrs[0] as { property: string }).property, 'value');
  assert.equal((el.attrs[0] as { signal: string }).signal, 'draft');
});

test('{@html expr} lowers to raw-html', () => {
  const ast = parseTemplate('{@html children}', FILE);
  const ir = lowerNodes(ast, makeScope([['children', 'binding']]));
  assert.equal(ir[0].kind, 'raw-html');
  assert.equal((ir[0] as { expr: string }).expr, 'children');
});

test('a component tag lowers to an include node, island flag threaded through', () => {
  const ast = parseTemplate('<Counter start={0} client:load />', FILE);
  const ir = lowerNodes(ast, makeScope([]));
  assert.equal(ir[0].kind, 'include');
  assert.equal((ir[0] as { component: string }).component, 'Counter');
  assert.equal((ir[0] as { island: boolean }).island, true);
});

test('a non-island component include has island: false', () => {
  const ast = parseTemplate('<Static text="hi" />', FILE);
  const ir = lowerNodes(ast, makeScope([]));
  assert.equal((ir[0] as { island: boolean }).island, false);
});

console.log(`\nir: all ${passed} tests passed`);
