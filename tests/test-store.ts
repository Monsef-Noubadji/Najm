/**
 * Najm Store & Context test suite — v1.0 Phase 2.
 * Proves: deep reactivity via Proxy (including NEW keys), path-precise
 * surgical updates (writing one field doesn't notify siblings' readers),
 * batched actions, time-travel replay, and context provide/inject
 * walking the ownership tree.
 */
import assert from 'node:assert/strict';
import { effect, createRoot } from '../runtime/signals';
import { defineStore } from '../runtime/store';
import { enableTimeTravel } from '../runtime/devtools-bridge';
import { createContext, provide, inject } from '../runtime/context';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('store: reads track, writes notify — basic reactivity', () => {
  const useCounter = defineStore({
    state: () => ({ count: 0 }),
    actions: { inc: (s: { count: number }) => { s.count++; } },
  });
  const store = useCounter();
  const log: number[] = [];
  createRoot(() => effect(() => log.push(store.count)));
  store.$actions.inc();
  store.$actions.inc();
  assert.deepEqual(log, [0, 1, 2]);
});

test('store: defineStore is a singleton — same call returns the same instance', () => {
  const useCounter = defineStore({ state: () => ({ n: 1 }) });
  assert.equal(useCounter(), useCounter());
});

test('store: deep reactivity — nested object writes notify, INCLUDING new keys', () => {
  const useApp = defineStore({
    state: () => ({ user: { name: 'Ada' } as { name: string; nickname?: string } }),
  });
  const store = useApp();
  const log: string[] = [];
  createRoot(() =>
    effect(() => {
      log.push(store.user.name + (store.user.nickname ?? ''));
    })
  );
  store.user.name = 'Grace'; // existing key
  store.user.nickname = 'The Admiral'; // NEW key — the Vue-2 failure mode
  assert.deepEqual(log, ['Ada', 'Grace', 'GraceThe Admiral']);
});

test('store: surgical updates — writing one field does not notify a sibling-only reader', () => {
  const useApp = defineStore({
    state: () => ({ a: 1, b: 100 }),
  });
  const store = useApp();
  let bRuns = 0;
  createRoot(() =>
    effect(() => {
      store.b;
      bRuns++;
    })
  );
  store.a = 2; // unrelated field
  store.a = 3;
  assert.equal(bRuns, 1); // the b-effect never re-ran
  store.b = 200;
  assert.equal(bRuns, 2);
});

test('store: actions batch their writes into one update wave', () => {
  const useApp = defineStore({
    state: () => ({ x: 0, y: 0 }),
    actions: {
      setBoth: (s: { x: number; y: number }, x: number, y: number) => {
        s.x = x;
        s.y = y;
      },
    },
  });
  const store = useApp();
  let runs = 0;
  createRoot(() =>
    effect(() => {
      store.x + store.y;
      runs++;
    })
  );
  store.$actions.setBoth(5, 10);
  assert.equal(runs, 2); // initial + ONE batched re-run, not two
});

test('store: getters are computed and reflect current state', () => {
  const useApp = defineStore({
    state: () => ({ price: 10, qty: 3 }),
    getters: { total: (s: { price: number; qty: number }) => s.price * s.qty },
  });
  const store = useApp();
  assert.equal(store.$getters.total, 30);
  store.qty = 5;
  assert.equal(store.$getters.total, 50);
});

test('store + devtools: time-travel records history and jumpTo restores exact snapshots', () => {
  const useApp = defineStore({
    state: () => ({ n: 0 }),
    actions: { inc: (s: { n: number }) => { s.n++; } },
  });
  const store = useApp();
  const tt = enableTimeTravel(store);
  store.$actions.inc();
  store.$actions.inc();
  store.$actions.inc();
  assert.equal(store.n, 3);
  assert.equal(tt.history().length, 3);
  tt.jumpTo(0); // back to the snapshot right after the FIRST inc
  assert.equal(store.n, 1);
  tt.jumpTo(2);
  assert.equal(store.n, 3);
});

test('context: inject() sees the nearest ancestor provide() down the ownership tree', () => {
  const Theme = createContext<string>('theme');
  let seen = '';
  createRoot(() => {
    provide(Theme, 'dark');
    effect(() => {
      // nested effect's owner chain walks up through the root scope
      seen = inject(Theme);
    });
  });
  assert.equal(seen, 'dark');
});

test('context: inject() falls back to the default value when nothing provides it', () => {
  const Locale = createContext<string>('locale', 'en-US');
  let seen = '';
  createRoot(() => {
    seen = inject(Locale);
  });
  assert.equal(seen, 'en-US');
});

test('context: inject() throws when no provider and no default exist', () => {
  const NoDefault = createContext<string>('no-default');
  assert.throws(() => {
    createRoot(() => inject(NoDefault));
  }, /no provider found/);
});

test('context: a nested scope shadows an outer provide() for its own subtree', () => {
  const Theme = createContext<string>('theme', 'light');
  const seen: string[] = [];
  createRoot(() => {
    provide(Theme, 'dark');
    seen.push(inject(Theme)); // outer: dark
    effect(() => {
      provide(Theme, 'high-contrast'); // shadows within this nested scope
      seen.push(inject(Theme)); // inner: high-contrast
    });
  });
  assert.deepEqual(seen, ['dark', 'high-contrast']);
});

console.log(`\nstore & context: all ${passed} tests passed`);
