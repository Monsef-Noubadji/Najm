/**
 * Reactivity core test suite — run with `npm test`.
 * No test framework: node:assert is plenty for a runtime this small.
 */
import assert from 'node:assert/strict';
import {
  signal,
  computed,
  effect,
  batch,
  untrack,
  onCleanup,
  get,
} from '../runtime/signals';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('signal: read/write/peek', () => {
  const s = signal(1);
  assert.equal(s.value, 1);
  s.value = 2;
  assert.equal(s.peek(), 2);
  s.update((n) => n + 1);
  assert.equal(s.value, 3);
});

test('effect: tracks dependencies and re-runs on write', () => {
  const s = signal('a');
  const log: string[] = [];
  effect(() => log.push(s.value));
  s.value = 'b';
  s.value = 'c';
  assert.deepEqual(log, ['a', 'b', 'c']);
});

test('effect: equal writes are no-ops', () => {
  const s = signal(1);
  let runs = 0;
  effect(() => {
    s.value;
    runs++;
  });
  s.value = 1;
  assert.equal(runs, 1);
});

test('effect: dynamic dependencies — untaken branches stop tracking', () => {
  const flag = signal(true);
  const a = signal('a');
  const b = signal('b');
  let runs = 0;
  effect(() => {
    runs++;
    flag.value ? a.value : b.value;
  });
  assert.equal(runs, 1);
  b.value = 'B'; // not a dependency while flag is true
  assert.equal(runs, 1);
  flag.value = false; // switch branches
  assert.equal(runs, 2);
  a.value = 'A'; // no longer a dependency
  assert.equal(runs, 2);
  b.value = 'BB'; // now it is
  assert.equal(runs, 3);
});

test('effect: disposer stops updates', () => {
  const s = signal(0);
  let runs = 0;
  const dispose = effect(() => {
    s.value;
    runs++;
  });
  dispose();
  s.value = 1;
  assert.equal(runs, 1);
});

test('computed: derives and memoizes by result equality', () => {
  const a = signal(1);
  const b = signal(2);
  const sum = computed(() => a.value + b.value);
  assert.equal(sum.value, 3);

  let downstream = 0;
  effect(() => {
    sum.value;
    downstream++;
  });
  a.value = 5;
  assert.equal(sum.value, 7);
  assert.equal(downstream, 2);

  // 5+2 → 4+3: sum is still 7, downstream must NOT re-run.
  batch(() => {
    a.value = 4;
    b.value = 3;
  });
  assert.equal(sum.value, 7);
  assert.equal(downstream, 2);
});

test('batch: many writes, one update wave', () => {
  const a = signal(1);
  const b = signal(2);
  let runs = 0;
  effect(() => {
    a.value + b.value;
    runs++;
  });
  batch(() => {
    a.value = 10;
    b.value = 20;
  });
  assert.equal(runs, 2); // initial + exactly one batched re-run
});

test('untrack: reads without subscribing', () => {
  const tracked = signal(0);
  const ignored = signal(0);
  let runs = 0;
  effect(() => {
    tracked.value;
    untrack(() => ignored.value);
    runs++;
  });
  ignored.value = 99;
  assert.equal(runs, 1);
  tracked.value = 1;
  assert.equal(runs, 2);
});

test('ownership: nested effects are disposed when the parent re-runs', () => {
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;
  effect(() => {
    outer.value;
    effect(() => {
      inner.value;
      innerRuns++;
    });
  });
  assert.equal(innerRuns, 1);
  inner.value = 1; // one live inner effect
  assert.equal(innerRuns, 2);
  outer.value = 1; // parent re-runs → old inner disposed, new one created
  assert.equal(innerRuns, 3);
  inner.value = 2; // still exactly ONE live inner effect (no leak)
  assert.equal(innerRuns, 4);
});

test('onCleanup: runs before re-run and on dispose', () => {
  const s = signal(0);
  const log: string[] = [];
  const dispose = effect(() => {
    const v = s.value;
    onCleanup(() => log.push(`clean ${v}`));
  });
  s.value = 1;
  dispose();
  assert.deepEqual(log, ['clean 0', 'clean 1']);
});

test('get: auto-unwraps signals, passes plain values through', () => {
  const s = signal('sig');
  assert.equal(get(s), 'sig');
  assert.equal(get('plain'), 'plain');
  assert.equal(get(42), 42);
});

console.log(`\nsignals: all ${passed} tests passed`);
