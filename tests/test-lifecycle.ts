/**
 * Beta lifecycle & instance test suite — run with `npm test`.
 * Exercises the functional component contract without a DOM: the fake
 * view's hydrate() creates effects exactly the way compiled bindings do.
 */
import assert from 'node:assert/strict';
import { signal, effect, batch, createRoot } from '../runtime/signals';
import { onMounted, onUpdated, onDestroyed } from '../runtime/lifecycle';
import { mountComponent, instantiate } from '../runtime/mount';
import { renderToHtml } from '../runtime/ssr';

const microtask = () => new Promise<void>((r) => queueMicrotask(r));

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** A component faking what the compiler emits: state + view closures. */
function makeComponent(log: string[]) {
  const count = signal(0);
  const comp = (props: any = {}) => {
    onMounted(() => log.push('mounted'));
    onUpdated(() => log.push('updated'));
    onDestroyed(() => log.push('destroyed'));
    return {
      ssr: () => `<span>${count.peek()}</span>`,
      hydrate: (_root: Element) => {
        // one "binding effect", like a compiled dynamic text node
        effect(() => {
          count.value;
          log.push('effect');
        });
      },
    };
  };
  return { comp, count };
}

await test('mount: hydrates, then fires onMounted exactly once', async () => {
  const log: string[] = [];
  const { comp } = makeComponent(log);
  await mountComponent(comp, null as unknown as Element);
  assert.deepEqual(log, ['effect', 'mounted']); // initial effect run ≠ update
});

await test('onUpdated: fires after graph changes, coalesced per microtask', async () => {
  const log: string[] = [];
  const { comp, count } = makeComponent(log);
  await mountComponent(comp, null as unknown as Element);
  log.length = 0;

  count.value = 1;
  count.value = 2;
  await microtask();
  // two effect runs, ONE coalesced updated
  assert.deepEqual(log, ['effect', 'effect', 'updated']);
});

await test('onUpdated: batch produces one effect run and one update', async () => {
  const log: string[] = [];
  const { comp, count } = makeComponent(log);
  await mountComponent(comp, null as unknown as Element);
  log.length = 0;

  batch(() => {
    count.value = 10;
    count.value = 20;
  });
  await microtask();
  assert.deepEqual(log, ['effect', 'updated']);
});

await test('unmount: disposes all owned effects, then fires onDestroyed', async () => {
  const log: string[] = [];
  const { comp, count } = makeComponent(log);
  const handle = await mountComponent(comp, null as unknown as Element);
  log.length = 0;

  handle.unmount();
  assert.deepEqual(log, ['destroyed']);

  count.value = 99; // the binding effect must be dead
  await microtask();
  assert.deepEqual(log, ['destroyed']);
});

await test('SSR: setup runs, hooks register, onMounted never fires', async () => {
  const log: string[] = [];
  const { comp } = makeComponent(log);
  const html = await renderToHtml(comp, {});
  assert.equal(html, '<span>0</span>');
  assert.deepEqual(log, []); // no DOM, no mounted, no effects
});

await test('renderToHtml: unwraps module default exports', async () => {
  const log: string[] = [];
  const { comp } = makeComponent(log);
  const html = await renderToHtml({ default: comp }, {});
  assert.equal(html, '<span>0</span>');
});

await test('hooks: throw outside component setup', () => {
  assert.throws(() => onMounted(() => {}), /outside component setup/);
});

await test('instantiate: rejects components that return no view', () => {
  assert.throws(
    () => instantiate((() => undefined) as any, {}),
    /must return \{ template/
  );
});

await test('createRoot: owns effects without tracking their reads', () => {
  const s = signal(0);
  const runs: number[] = [];
  const { dispose } = createRoot(() => {
    // this read happens in the scope, NOT inside an effect — it must
    // not subscribe the scope to s (a root scope never re-runs)
    s.value;
    effect(() => runs.push(s.value));
  });
  s.value = 1;
  assert.deepEqual(runs, [0, 1]);
  dispose();
  s.value = 2;
  assert.deepEqual(runs, [0, 1]); // owned effect died with the scope
});

console.log(`\nlifecycle: all ${passed} tests passed`);
