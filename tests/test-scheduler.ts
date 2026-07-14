/**
 * Scheduler test suite — run with `npm test`.
 * See docs/rfcs/RFC-0005-scheduler-design.md. Covers the RFC's Verification
 * section: batch() unchanged (regression-gated by test-signals.ts /
 * test-lifecycle.ts, not repeated here), plus the two guarantees new to
 * this RFC: explicit write-order ordering for independent (non-batched)
 * writes, and same-flush folding for computations scheduled mid-flush.
 */
import assert from 'node:assert/strict';
import { signal, effect, batch, createRoot } from '../runtime/signals';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('ordering: two independent signal writes run effects in write order, not reversed', () => {
  // Two signals, each read by its own effect, PLUS a third effect that
  // reads both (the "shared dependency"). Writing a then b, outside any
  // batch, must run effects in the order the writes happened — not
  // reversed, and not whatever an unordered structure would happen to
  // produce.
  const a = signal('a0');
  const b = signal('b0');
  const log: string[] = [];

  createRoot(() => {
    effect(() => log.push(`A:${a.value}`));
    effect(() => log.push(`B:${b.value}`));
    // shared-dependency effect: reads both signals
    effect(() => log.push(`AB:${a.value}/${b.value}`));
  });
  log.length = 0; // drop the three initial runs

  a.value = 'a1'; // sync flush #1: A's effect, then the shared effect
  b.value = 'b1'; // sync flush #2: B's effect, then the shared effect

  assert.deepEqual(log, ['A:a1', 'AB:a1/b0', 'B:b1', 'AB:a1/b1']);
});

test('ordering: write order holds in the opposite direction too (not incidental)', () => {
  // Same shape, writes issued b-then-a — proves the previous test's pass
  // isn't a coincidence of declaration order.
  const a = signal(1);
  const b = signal(2);
  const log: string[] = [];

  createRoot(() => {
    effect(() => log.push(`A:${a.value}`));
    effect(() => log.push(`B:${b.value}`));
  });
  log.length = 0;

  b.value = 20;
  a.value = 10;

  assert.deepEqual(log, ['B:20', 'A:10']);
});

test('nested trigger: a computation scheduled during a flush is folded into the same flush', () => {
  // effect1 writes a second signal as a side effect of running. That
  // write's own subscriber (effect2) must run as part of THIS flush
  // (interleaved into the same drain), not deferred to a later,
  // separately-observable flush.
  const trigger = signal(0);
  const derived = signal('idle');
  const order: string[] = [];

  createRoot(() => {
    effect(() => {
      // effect1: on trigger change, write `derived` — a nested schedule
      // while the outer sync flush is still draining.
      const v = trigger.value;
      order.push(`effect1:${v}`);
      if (v > 0) derived.value = `derived-${v}`;
    });
    effect(() => {
      order.push(`effect2:${derived.value}`);
    });
  });
  order.length = 0; // drop initial runs (effect1:0, effect2:idle)

  trigger.value = 1;

  // If the nested write started a NEW flush (e.g. via a fresh microtask
  // or a deferred queue), effect2's re-run would not appear synchronously
  // in `order` right after this assignment. Folding into the same flush
  // means it runs synchronously, right here, in the same call stack.
  assert.deepEqual(order, ['effect1:1', 'effect2:derived-1']);
});

test('batch: coalesces multiple writes into exactly one flush per computation', () => {
  const a = signal(1);
  const b = signal(2);
  const c = signal(3);
  let runs = 0;
  const runLog: number[] = [];

  createRoot(() => {
    effect(() => {
      runLog.push(a.value + b.value + c.value);
      runs++;
    });
  });
  assert.equal(runs, 1); // initial run

  batch(() => {
    a.value = 10;
    b.value = 20;
    c.value = 30;
  });

  // Three writes inside one batch → exactly ONE re-run, not three.
  assert.equal(runs, 2);
  assert.deepEqual(runLog, [6, 60]);
});

test('batch: a computation triggered by multiple writes in the batch still runs once (dedup)', () => {
  // Same computation subscribed to both `a` and `b` — writing both in one
  // batch must not run it twice (the old `Batching` Set deduped by
  // identity; the scheduler's sync queue must preserve that).
  const a = signal(1);
  const b = signal(2);
  let runs = 0;

  createRoot(() => {
    effect(() => {
      a.value;
      b.value;
      runs++;
    });
  });
  assert.equal(runs, 1);

  batch(() => {
    a.value = 100;
    b.value = 200;
  });

  assert.equal(runs, 2); // not 3
});

test('sync priority: writes outside batch() still flush immediately (unchanged default)', () => {
  const s = signal(0);
  const log: number[] = [];
  createRoot(() => {
    effect(() => log.push(s.value));
  });
  log.length = 0;

  s.value = 1;
  // No batch(), no await, no microtask — if this were deferred, `log`
  // would still be empty right here.
  assert.deepEqual(log, [1]);

  s.value = 2;
  assert.deepEqual(log, [1, 2]);
});

console.log(`\nscheduler: all ${passed} tests passed`);
