/**
 * RFC-0007 partial hydration test suite — `client:visible` islands.
 *
 * Proves, at the generated-code level (same technique as
 * tests/test-hoisting.ts):
 *   1. `client:visible` compiles to a distinguishable $island() call
 *      carrying the 'visible' strategy argument.
 *   2. `client:load` islands' generated code is UNCHANGED in shape —
 *      the regression guard for the pre-existing, browser-verified
 *      eager-hydration mechanism.
 *
 * Also exercises runtime/ssr.ts's renderIsland() directly (server side)
 * and runtime/client.ts's IntersectionObserver branch (client side, via
 * a minimal IO polyfill) so the plumbing is verified end to end, not
 * just at the codegen-string level.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { compile } from '../compiler/codegen';
import { parseTemplate } from '../compiler/parse';
import { lowerNodes } from '../compiler/ir';
import type { IRInclude } from '../compiler/ir';
import { makeScope } from '../compiler/semantics';
import { beginRender, endRender, renderIsland } from '../runtime/ssr';
import type { ComponentView, FunctionalComponent } from '../runtime/mount';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
async function atest(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const opts = { id: path.resolve('src/Fixture.najm'), root: process.cwd() };

/* -------------------------------------------------------------------- */
/* Parser / IR                                                           */
/* -------------------------------------------------------------------- */

test('parser: client:visible is recognized as an island directive with strategy "visible"', () => {
  const ast = parseTemplate('<Counter start={0} client:visible />', 'fixture.najm');
  const comp = ast[0] as any;
  assert.equal(comp.type, 'component');
  assert.equal(comp.island, true);
  assert.equal(comp.islandStrategy, 'visible');
});

test('parser: client:load still yields strategy "load" (default, unchanged)', () => {
  const ast = parseTemplate('<Counter start={0} client:load />', 'fixture.najm');
  const comp = ast[0] as any;
  assert.equal(comp.island, true);
  assert.equal(comp.islandStrategy, 'load');
});

test('parser: an unsupported client:idle directive still fails loudly', () => {
  assert.throws(
    () => parseTemplate('<Counter client:idle />', 'fixture.najm'),
    /unsupported directive client:idle/
  );
});

test('IR: client:visible threads islandStrategy through IRInclude', () => {
  const ast = parseTemplate('<Counter start={0} client:visible />', 'fixture.najm');
  const ir = lowerNodes(ast, makeScope([]));
  assert.equal(ir[0].kind, 'include');
  const inc = ir[0] as IRInclude;
  assert.equal(inc.island, true);
  assert.equal(inc.islandStrategy, 'visible');
});

test('IR: client:load threads islandStrategy "load" through IRInclude', () => {
  const ast = parseTemplate('<Counter start={0} client:load />', 'fixture.najm');
  const ir = lowerNodes(ast, makeScope([]));
  const inc = ir[0] as IRInclude;
  assert.equal(inc.islandStrategy, 'load');
});

test('IR: a non-island include has islandStrategy null', () => {
  const ast = parseTemplate('<Static text="hi" />', 'fixture.najm');
  const ir = lowerNodes(ast, makeScope([]));
  const inc = ir[0] as IRInclude;
  assert.equal(inc.island, false);
  assert.equal(inc.islandStrategy, null);
});

/* -------------------------------------------------------------------- */
/* Codegen                                                               */
/* -------------------------------------------------------------------- */

test('codegen: a client:visible component compiles to $island(...) carrying the "visible" strategy arg', () => {
  const src = `
import Counter from './Counter.najm';
export default function Fixture() {
  return {
    template: \`<Counter start={0} client:visible />\`,
  };
}`;
  const { code } = compile(src, opts);
  assert.match(code, /\$island\(Counter, "\/src\/Counter\.najm", \{ "start": \(0\) \}, "visible"\)/);
});

test('codegen: a client:load component compiles to $island(...) with NO 4th argument (unchanged shape)', () => {
  const src = `
import Counter from './Counter.najm';
export default function Fixture() {
  return {
    template: \`<Counter start={0} client:load />\`,
  };
}`;
  const { code } = compile(src, opts);
  // Exact regression guard: this is the pre-existing call shape. If this
  // fails, the client:load default path's generated code changed shape,
  // which this increment must not do.
  assert.match(code, /\$island\(Counter, "\/src\/Counter\.najm", \{ "start": \(0\) \}\)/);
  assert.ok(
    !/\$island\(Counter, "\/src\/Counter\.najm", \{ "start": \(0\) \}, "load"\)/.test(code),
    'client:load must not emit an explicit "load" strategy argument — it is the implicit default'
  );
});

test('codegen: client:visible and client:load produce textually distinguishable $island calls', () => {
  const visibleSrc = `
import Counter from './Counter.najm';
export default function Fixture() {
  return { template: \`<Counter client:visible />\` };
}`;
  const loadSrc = `
import Counter from './Counter.najm';
export default function Fixture() {
  return { template: \`<Counter client:load />\` };
}`;
  const visible = compile(visibleSrc, opts).code;
  const load = compile(loadSrc, opts).code;
  assert.notEqual(visible, load);
  assert.ok(visible.includes('"visible"'));
  assert.ok(!load.includes('"visible"'));
  assert.ok(!load.includes('"load"')); // implicit default, not spelled out
});

test('codegen: a non-island (static) include is unaffected — still $comp(), no strategy plumbing', () => {
  const src = `
import Counter from './Counter.najm';
export default function Fixture() {
  return { template: \`<Counter start={0} />\` };
}`;
  const { code } = compile(src, opts);
  assert.match(code, /\$comp\(Counter, \{ "start": \(0\) \}\)/);
  assert.ok(!code.includes('$island('));
});

/* -------------------------------------------------------------------- */
/* Runtime — server side (runtime/ssr.ts renderIsland())                 */
/* -------------------------------------------------------------------- */

function makeHealthyComponent(html: string): FunctionalComponent {
  return (): ComponentView => ({
    ssr: async () => html,
    hydrate: async () => {},
  });
}

await atest('runtime/ssr: renderIsland() with no strategy arg omits data-hydrate (client:load, unchanged)', async () => {
  const html = await beginRender(async () => {
    const html = await renderIsland(makeHealthyComponent('<p>hi</p>'), '/src/Counter.najm', {});
    endRender();
    return html;
  });
  assert.ok(html.startsWith('<najm-island style="display:contents" data-src="/src/Counter.najm" data-props='));
  assert.ok(!html.includes('data-hydrate'));
});

await atest('runtime/ssr: renderIsland() with strategy "load" explicitly also omits data-hydrate', async () => {
  const html = await beginRender(async () => {
    const html = await renderIsland(makeHealthyComponent('<p>hi</p>'), '/src/Counter.najm', {}, 'load');
    endRender();
    return html;
  });
  assert.ok(!html.includes('data-hydrate'));
});

await atest('runtime/ssr: renderIsland() with strategy "visible" emits data-hydrate="visible"', async () => {
  const html = await beginRender(async () => {
    const html = await renderIsland(makeHealthyComponent('<p>hi</p>'), '/src/Counter.najm', {}, 'visible');
    endRender();
    return html;
  });
  assert.match(html, /<najm-island style="display:contents" data-src="\/src\/Counter\.najm" data-hydrate="visible" data-props=/);
});

/* -------------------------------------------------------------------- */
/* Runtime — client side (runtime/client.ts hydrateIslands())            */
/* -------------------------------------------------------------------- */

/**
 * Minimal DOM + IntersectionObserver polyfill sufficient to exercise
 * hydrateIslands()'s branching logic under Node (no jsdom dependency in
 * this repo). Just enough querySelectorAll/getAttribute/setAttribute/
 * firstElementChild surface for the function under test.
 *
 * firstElementChild matters: `<najm-island>` renders `style="display:
 * contents"` (see runtime/ssr.ts's renderIsland()), which makes the
 * wrapper generate no box of its own — getBoundingClientRect() on it is
 * always {0,0,0,0} in real browsers, so an IntersectionObserver watching
 * the WRAPPER never reliably reports an intersection (browser-verified:
 * this was caught live testing the demo page — see runtime/client.ts's
 * observeLazyIslands() comment). The fix observes the island's first
 * element child instead, so this fake models that child too.
 */
class FakeElement {
  private attrs = new Map<string, string>();
  firstElementChild: FakeElement | null;
  constructor(attrs: Record<string, string>, child: FakeElement | null = null) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    this.firstElementChild = child;
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
}

await atest('client: eager (client:load-shaped) island hydrates immediately, no IntersectionObserver involved', async () => {
  const eagerEl = new FakeElement({
    'data-src': '/src/Eager.najm',
    'data-props': '{}',
  });

  const originalDoc = (globalThis as any).document;
  const originalIO = (globalThis as any).IntersectionObserver;
  let ioConstructed = false;
  (globalThis as any).IntersectionObserver = class {
    constructor() {
      ioConstructed = true;
    }
    observe() {}
    disconnect() {}
  };
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => (sel === 'najm-island' ? [eagerEl] : []),
  };

  try {
    const { hydrateIslands } = await import('../runtime/client');
    let loaded = false;
    await hydrateIslands({
      '/src/Eager.najm': async () => {
        loaded = true;
        return { default: () => ({ ssr: async () => '<p>eager</p>', hydrate: () => {} }) };
      },
    });
    assert.equal(loaded, true, 'eager island must be dynamically imported immediately');
    assert.equal(eagerEl.getAttribute('data-hydrated'), '');
    assert.equal(ioConstructed, false, 'client:load path must never touch IntersectionObserver');
  } finally {
    (globalThis as any).document = originalDoc;
    (globalThis as any).IntersectionObserver = originalIO;
  }
});

await atest('client: lazy (client:visible-shaped) island is NOT fetched until IntersectionObserver reports intersection', async () => {
  const lazyChild = new FakeElement({});
  const lazyEl = new FakeElement(
    {
      'data-src': '/src/Lazy.najm',
      'data-hydrate': 'visible',
      'data-props': '{}',
    },
    lazyChild
  );

  const originalDoc = (globalThis as any).document;
  const originalIO = (globalThis as any).IntersectionObserver;

  let capturedCallback: ((entries: { isIntersecting: boolean; target: unknown }[]) => void) | null = null;
  let observedTarget: unknown = null;
  let disconnected = false;
  let observedOptions: any = null;

  (globalThis as any).IntersectionObserver = class {
    constructor(cb: any, options: any) {
      capturedCallback = cb;
      observedOptions = options;
    }
    observe(target: unknown) {
      observedTarget = target;
    }
    disconnect() {
      disconnected = true;
    }
  };
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => (sel === 'najm-island' ? [lazyEl] : []),
  };

  try {
    // Re-import fresh so module-level state (none currently, but future-
    // proof) doesn't leak between the two client tests.
    const clientMod = await import(`../runtime/client?t=${Date.now()}`);
    let loaded = false;
    const hydrateDone = clientMod.hydrateIslands({
      '/src/Lazy.najm': async () => {
        loaded = true;
        return { default: () => ({ ssr: async () => '<p>lazy</p>', hydrate: () => {} }) };
      },
    });

    // hydrateIslands() resolves once the eager batch settles; the lazy
    // island's observer is attached synchronously within that same call,
    // so awaiting it is enough to assert "not yet hydrated" afterward.
    await hydrateDone;

    assert.equal(loaded, false, 'client:visible island must not be fetched before it intersects the viewport');
    assert.equal(lazyEl.getAttribute('data-hydrated'), null);
    // The wrapper itself is display:contents (zero-box) — the observer
    // must watch its rendered first element child, not the wrapper, or
    // real browsers never report an intersection at all (see FakeElement's
    // doc comment / runtime/client.ts's observeLazyIslands()).
    assert.ok(observedTarget === lazyChild, 'the lazy island\'s first element child must be observed, not the display:contents wrapper');
    assert.equal(observedOptions?.rootMargin, '200px');

    // Simulate the element scrolling into view.
    if (!capturedCallback) throw new Error('IntersectionObserver callback must have been captured');
    const fireIntersection = capturedCallback as (entries: { isIntersecting: boolean; target: unknown }[]) => void;
    fireIntersection([{ isIntersecting: true, target: lazyEl }]);

    // hydrateOne() is fire-and-forget (void) inside the observer callback;
    // give its microtasks/promise chain a turn to complete.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(loaded, true, 'scrolling into view must trigger the dynamic import');
    assert.equal(lazyEl.getAttribute('data-hydrated'), '');
    assert.equal(disconnected, true, 'the observer must disconnect itself after the one-shot trigger');
  } finally {
    (globalThis as any).document = originalDoc;
    (globalThis as any).IntersectionObserver = originalIO;
  }
});

console.log(`\npartial-hydration: all ${passed} tests passed`);
