/**
 * Semantic-analysis unit tests (RFC-0003 migration plan step 3) —
 * `compiler/semantics.ts`. Covers declaration scanning, real
 * scope-aware `deps` resolution (replacing `ir.ts`'s old coarse
 * free-identifier scan), each-block loop-variable scoping, and the
 * dual-mode design (`ir.ts`'s `lowerNodes()` throws on the first
 * unresolved reference; `analyzeSemantics()` collects every one without
 * throwing, for future tooling).
 */
import assert from 'node:assert/strict';
import { parseTemplate } from '../compiler/parse';
import { lowerNodes } from '../compiler/ir';
import type { IRDynText, IRElement, IRList } from '../compiler/ir';
import { scanDeclarations, resolveExprDeps, makeScope, analyzeSemantics } from '../compiler/semantics';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const FILE = 'semantics-test.najm';

/* -------------------------------------------------------------------- */
/* Declared signal → deps resolves to exactly that signal                */
/* -------------------------------------------------------------------- */

test('a signal declared as `const count = signal(0)` and referenced as {count} resolves deps to exactly [\'count\']', () => {
  const source = `
export default function Fixture() {
  const count = signal(0);
  return {
    template: \`{count}\`,
  };
}`;
  const ast = parseTemplate('{count}', FILE);
  const scope = scanDeclarations('\n  const count = signal(0);\n  ', '');
  const ir = lowerNodes(ast, scope);
  assert.equal(ir[0].kind, 'dyn-text');
  assert.deepEqual((ir[0] as IRDynText).deps, ['count']);
  void source; // documents the real component shape this scope was scanned from
});

/* -------------------------------------------------------------------- */
/* Each-block loop variables are valid scope, not signals, not flagged   */
/* -------------------------------------------------------------------- */

test('each-block loop variables (todo, i) are valid scope: not flagged, and not reported as signal deps', () => {
  const scope = scanDeclarations('\n  const todos = signal([]);\n  ', '');
  const ast = parseTemplate(
    '{#each todos as todo, i}<li>{todo.text} #{i + 1}</li>{/each}',
    FILE
  );
  const ir = lowerNodes(ast, scope);
  assert.equal(ir[0].kind, 'list');
  const list = ir[0] as IRList;
  const li = list.body[0] as IRElement;
  // {todo.text} — `todo` is a loop var: valid scope, but NOT a dep (it is
  // not a declared signal — it's local scope introduced by the each-block).
  const todoText = li.children[0] as IRDynText;
  assert.equal(todoText.expr, 'todo.text');
  assert.deepEqual(todoText.deps, []);
  // #{i + 1} — `i` is the index var: same story, not a dep. (children[1]
  // is the static " #" text between the two dynamic pieces.)
  const indexExpr = li.children[2] as IRDynText;
  assert.equal(indexExpr.expr, 'i + 1');
  assert.deepEqual(indexExpr.deps, []);
});

test('each-block loop variables do not leak outside the each-block', () => {
  const scope = scanDeclarations('\n  const todos = signal([]);\n  ', '');
  // `todo` referenced OUTSIDE the each-block it was introduced by must be unresolved.
  const ast = parseTemplate('{#each todos as todo}<li>{todo}</li>{/each}<p>{todo}</p>', FILE);
  assert.throws(() => lowerNodes(ast, scope), /`todo` is not defined/);
});

/* -------------------------------------------------------------------- */
/* Genuinely unresolved identifiers are flagged / thrown                */
/* -------------------------------------------------------------------- */

test('a genuinely unresolved identifier ({doesNotExist}) throws at compile time', () => {
  const ast = parseTemplate('{doesNotExist}', FILE);
  assert.throws(
    () => lowerNodes(ast, makeScope([])),
    /`doesNotExist` is not defined — expected a declared signal, prop, function, or loop variable in scope/
  );
});

/* -------------------------------------------------------------------- */
/* Prop references are valid scope                                       */
/* -------------------------------------------------------------------- */

test('a prop reference (props.initial) is recognized as valid scope, not flagged', () => {
  const scope = scanDeclarations('', 'props = {}');
  const ast = parseTemplate('{props.initial}', FILE);
  const ir = lowerNodes(ast, scope);
  assert.equal(ir[0].kind, 'dyn-text');
  // `props` itself is valid scope but not a signal, so deps is empty.
  assert.deepEqual((ir[0] as IRDynText).deps, []);
});

test('a destructured-const prop binding (const remaining = props.foo) resolves as valid non-signal scope', () => {
  // Mirrors layout.najm's `const children = props.children;` pattern —
  // a plain binding derived from props, not itself a signal.
  const scope = scanDeclarations('\n  const children = props.children;\n  ', 'props = {}');
  const ast = parseTemplate('{@html children}', FILE);
  const ir = lowerNodes(ast, scope);
  assert.equal(ir[0].kind, 'raw-html');
});

/* -------------------------------------------------------------------- */
/* Function/handler references resolve correctly                        */
/* -------------------------------------------------------------------- */

test('a handler reference (click)={addTodo} where addTodo is a declared function resolves, not flagged', () => {
  const scope = scanDeclarations(
    '\n  const draft = signal("");\n  const addTodo = () => { draft.value = ""; };\n  ',
    ''
  );
  const ast = parseTemplate('<button (click)={addTodo()}>Add</button>', FILE);
  // Must not throw.
  const ir = lowerNodes(ast, scope);
  const el = ir[0] as IRElement;
  assert.equal(el.attrs[0].kind, 'event');
});

test('an on:click handler reference to a declared function resolves, not flagged', () => {
  const scope = scanDeclarations('\n  function remove(id) { return id; }\n  ', '');
  const ast = parseTemplate('<button on:click={remove}>x</button>', FILE);
  const ir = lowerNodes(ast, scope);
  const el = ir[0] as IRElement;
  assert.equal(el.attrs[0].kind, 'event');
});

test('a statement handler referencing a declared function by call ((click)={() => remove(todo.id)}) resolves inside an each-block', () => {
  const scope = scanDeclarations(
    '\n  const todos = signal([]);\n  function remove(id) { return id; }\n  ',
    ''
  );
  const ast = parseTemplate(
    '{#each todos as todo}<button (click)={remove(todo.id)}>x</button>{/each}',
    FILE
  );
  const ir = lowerNodes(ast, scope); // must not throw
  assert.equal(ir[0].kind, 'list');
});

/* -------------------------------------------------------------------- */
/* scanDeclarations: signal vs. function vs. binding classification      */
/* -------------------------------------------------------------------- */

test('scanDeclarations classifies signal(...)/computed(...) initializers as kind "signal"', () => {
  const scope = scanDeclarations(
    '\n  const count = signal(0);\n  const doubled = computed(() => count.value * 2);\n  ',
    ''
  );
  assert.equal(scope.decls.get('count')?.kind, 'signal');
  assert.equal(scope.decls.get('doubled')?.kind, 'signal');
});

test('scanDeclarations classifies function declarations and arrow-function consts as kind "function"', () => {
  const scope = scanDeclarations(
    '\n  function addTodo() {}\n  const remove = (id) => { return id; };\n  const asyncFn = async () => {};\n  ',
    ''
  );
  assert.equal(scope.decls.get('addTodo')?.kind, 'function');
  assert.equal(scope.decls.get('remove')?.kind, 'function');
  assert.equal(scope.decls.get('asyncFn')?.kind, 'function');
});

test('scanDeclarations classifies plain const/let initializers as kind "binding"', () => {
  const scope = scanDeclarations(
    '\n  const facts = ["a", "b"];\n  let nextId = 0;\n  const renderedAt = new Date().toUTCString();\n  ',
    ''
  );
  assert.equal(scope.decls.get('facts')?.kind, 'binding');
  assert.equal(scope.decls.get('nextId')?.kind, 'binding');
  assert.equal(scope.decls.get('renderedAt')?.kind, 'binding');
});

test('scanDeclarations extracts simple destructured const bindings', () => {
  const scope = scanDeclarations('\n  const { initial, extra } = props;\n  ', 'props = {}');
  assert.equal(scope.decls.get('initial')?.kind, 'binding');
  assert.equal(scope.decls.get('extra')?.kind, 'binding');
});

test('scanDeclarations recognizes a bare `props` parameter as the scope\'s propsParam', () => {
  const scope = scanDeclarations('', 'props = {}');
  assert.equal(scope.propsParam, 'props');
});

/* -------------------------------------------------------------------- */
/* Known globals never flagged                                           */
/* -------------------------------------------------------------------- */

test('known globals (Math, console, JSON, $event) are never flagged as unresolved', () => {
  const result = resolveExprDeps('Math.max(1, 2) + JSON.stringify(console) + $event.type', makeScope([]), new Set());
  assert.deepEqual(result.unresolved, []);
});

/* -------------------------------------------------------------------- */
/* String literals are not mistaken for identifiers                     */
/* -------------------------------------------------------------------- */

test('identifiers-shaped words inside string literals are not treated as free identifiers', () => {
  const scope = scanDeclarations('\n  const todos = signal([]);\n  ', '');
  const ast = parseTemplate(
    '{#each todos as todo}<li class={todo.done ? "done" : "notdone"}>{todo.text}</li>{/each}',
    FILE
  );
  // Must not throw — "done"/"notdone" are string literals, not identifiers.
  const ir = lowerNodes(ast, scope);
  assert.equal(ir[0].kind, 'list');
});

/* -------------------------------------------------------------------- */
/* Dual-mode: analyzeSemantics() returns diagnostics without throwing    */
/* -------------------------------------------------------------------- */

test('analyzeSemantics() returns structured diagnostics for a file with an unresolved reference, without throwing', () => {
  const source = `
export default function Broken() {
  const count = signal(0);
  return {
    template: \`<p>{count} and {doesNotExist}</p>\`,
  };
}`;
  const ast = parseTemplate('<p>{count} and {doesNotExist}</p>', FILE);
  const result = analyzeSemantics(source, ast); // must not throw
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].identifier, 'doesNotExist');
  assert.equal(result.diagnostics[0].severity, 'error');
  assert.match(result.diagnostics[0].message, /doesNotExist.*is not defined/);
});

test('analyzeSemantics() returns zero diagnostics for a file with no unresolved references', () => {
  const source = `
export default function Ok(props = {}) {
  const count = signal(0);
  return {
    template: \`{count} {props.label}\`,
  };
}`;
  const ast = parseTemplate('{count} {props.label}', FILE);
  const result = analyzeSemantics(source, ast);
  assert.deepEqual(result.diagnostics, []);
});

test('analyzeSemantics() correctly scopes each-block loop variables (no false positive) and still catches real errors elsewhere', () => {
  const source = `
export default function Mixed() {
  const todos = signal([]);
  return {
    template: \`{#each todos as todo, i}<li>{todo.text} {i}</li>{/each}<p>{nope}</p>\`,
  };
}`;
  const ast = parseTemplate(
    '{#each todos as todo, i}<li>{todo.text} {i}</li>{/each}<p>{nope}</p>',
    FILE
  );
  const result = analyzeSemantics(source, ast);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].identifier, 'nope');
});

test('analyzeSemantics() works for the SFC <script> style too', () => {
  const source = `<script>
  const name = props.params.name;
</script>`;
  const ast = parseTemplate('<h1>Hello, {name}!</h1><p>{missing}</p>', FILE);
  const result = analyzeSemantics(source, ast);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].identifier, 'missing');
});

console.log(`\nsemantics: all ${passed} tests passed`);
