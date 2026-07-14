/**
 * Najm Scheduler
 * =================================================================
 * See docs/rfcs/RFC-0005-scheduler-design.md for the design rationale.
 *
 * This module centralizes flush timing for the reactivity graph. It does
 * NOT change the reactivity model's semantics — `signal.value = x` outside
 * `batch()` still runs subscribers synchronously, exactly as before. What
 * moves here is the *bookkeeping*: how a set of triggered computations
 * gets queued and drained, so `batch()` (signals.ts) and the `onUpdated`
 * microtask coalescing (lifecycle.ts) share one mechanism instead of two
 * independent, hand-rolled ones.
 *
 * ORDERING GUARANTEE: within one flush, computations run in the order
 * they were scheduled (insertion order) — a `Set`'s iteration order,
 * exactly like the `Batching` set `batch()` used before this refactor. A
 * computation scheduled *during* a flush (e.g. a computed's re-run
 * triggers another effect) is appended to the SAME flush's `Set` and gets
 * visited by the SAME `for...of` loop draining it — `Set` iteration
 * visits items added mid-iteration as long as they haven't been visited
 * yet, which is precisely the "folded into the same flush" guarantee and
 * precisely what today's `batch()` already relied on. A `Set` is also
 * used (not a plain array) so that a computation triggered by more than
 * one write in the same flush is still only queued — and therefore only
 * run — once, matching today's dedup behavior.
 */

import type { Computation } from './signals';

export type Priority = 'sync' | 'microtask' | 'idle';

export interface Scheduler {
  /** Queue `computation` to run at `priority`. */
  schedule(computation: Computation, priority: Priority): void;
  /** Drain the `sync` queue synchronously, in scheduled order. */
  flush(): void;
  /** Ensure the `microtask` queue is drained in exactly one upcoming microtask. */
  flushMicrotask(): void;
}

/**
 * A microtask-coalesced callback slot: `request()` may be called any
 * number of times before the microtask fires, but the callback runs at
 * most once per microtask. This is the same coalescing primitive that
 * backs `Scheduler.schedule(c, 'microtask')` for `Computation`s, exposed
 * directly for `ComponentInstance.scheduleUpdated()` (lifecycle.ts),
 * which coalesces "run all onUpdated hooks" rather than re-running a
 * single `Computation` — so it cannot go through `schedule()`'s
 * `Computation`-shaped signature, but it shares the exact same
 * queue-then-drain-in-one-microtask mechanism instead of hand-rolling
 * its own `queueMicrotask` bookkeeping (RFC-0005).
 */
export interface MicrotaskSlot {
  /** Ensure `callback` runs in the next microtask; a no-op if already queued. */
  request(): void;
}

/** Create a coalesced microtask slot around `callback`. */
export function createMicrotaskSlot(callback: () => void): MicrotaskSlot {
  let pending = false;
  return {
    request(): void {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        callback();
      });
    },
  };
}

/**
 * RFC-0010 devtools hook: optional callbacks invoked around the two
 * actual drain points below (`drainSync`/`flushMicrotask`'s queue loop),
 * each given the count of computations that ran and the elapsed time. A
 * Set (not a single slot) because `devtools-timing.ts` (flush timing) and
 * `devtools-graph.ts` (broadcast-after-drain) are independent opt-ins
 * that may both be enabled at once — see RFC-0010's "Alternatives
 * considered". Empty when no instrumentation is enabled — one `if
 * (drainHooks.size)` check, same cost class as the existing `if
 * (syncQueue)` checks already on this path, so this is zero-cost when
 * unset. This Set is the only reach either devtools module has into
 * scheduler.ts; `signals.ts` and `lifecycle.ts`'s calls into the
 * scheduler are unchanged by its presence.
 */
type DrainHook = (priority: Priority, computationCount: number, durationMs: number) => void;
const drainHooks = new Set<DrainHook>();

/** @internal — devtools-timing.ts / devtools-graph.ts: register/unregister a drain-timing hook. */
export function __addDrainHook(hook: DrainHook): () => void {
  drainHooks.add(hook);
  return () => drainHooks.delete(hook);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * The in-progress `sync` queue, non-null exactly while a sync flush is
 * draining (i.e. while inside `batch()`, or — via re-entrancy — while a
 * queued computation's own `run()` triggers further sync writes). `null`
 * the rest of the time: a bare (non-batched) signal write hits `schedule`
 * with this `null`, which is what makes that write run immediately.
 */
let syncQueue: Set<Computation> | null = null;

/** The `microtask` queue: computations waiting for the next microtask flush. */
let microtaskQueue: Set<Computation> = new Set();
let microtaskFlushPending = false;

function schedule(computation: Computation, priority: Priority): void {
  switch (priority) {
    case 'sync': {
      if (syncQueue) {
        syncQueue.add(computation);
      } else {
        computation.run();
      }
      break;
    }
    case 'microtask': {
      microtaskQueue.add(computation);
      flushMicrotask();
      break;
    }
    case 'idle': {
      // Reserved for future non-urgent work — see RFC-0005 v1 scope.
      // Nothing consumes 'idle' yet, so there is nothing to enqueue into.
      break;
    }
  }
}

/**
 * Public `flush()`: drain the sync queue synchronously right now. A no-op
 * if a sync flush is already in progress (its own `for...of` is already
 * draining, including anything scheduled after this call returns within
 * the same call stack).
 */
function flush(): void {
  if (syncQueue) return;
  drainSync();
}

/**
 * Open the sync queue, run `fn`, then drain whatever was queued — this is
 * `batch()`'s engine, factored out so signals.ts stays a thin wrapper.
 * Nesting (`batch()` inside `batch()`) reuses the outer queue: only the
 * outermost call opens/drains, matching the original `Batching` guard of
 * "already inside a batch — just run".
 */
function withSyncFlush<T>(fn: () => T): T {
  if (syncQueue) return fn();
  syncQueue = new Set<Computation>();
  try {
    return fn();
  } finally {
    drainSync();
  }
}

/** Drain the current sync queue in scheduled order, then close it. */
function drainSync(): void {
  const queue = syncQueue;
  if (!queue) return;
  const start = drainHooks.size ? now() : 0;
  let count = 0;
  // NOTE: intentionally iterating the live `Set` (not a snapshot/copy) —
  // this is what lets a computation scheduled while an earlier one's
  // `run()` executes get folded into this same drain (see module doc).
  for (const c of queue) {
    c.run();
    count++;
  }
  syncQueue = null;
  if (drainHooks.size) {
    const durationMs = now() - start;
    for (const hook of drainHooks) hook('sync', count, durationMs);
  }
}

function flushMicrotask(): void {
  if (microtaskFlushPending) return;
  if (microtaskQueue.size === 0) return;
  microtaskFlushPending = true;
  queueMicrotask(() => {
    microtaskFlushPending = false;
    // Snapshot + reset before draining: anything scheduled while these
    // computations run (re-entrant microtask scheduling) starts a fresh
    // pending flush rather than extending this one — consistent with
    // `sync`'s "only re-entrancy from an active drain folds in" rule,
    // since by the time this callback runs, the flush that scheduled it
    // has already finished (the sync call stack that scheduled it is gone).
    const queue = microtaskQueue;
    microtaskQueue = new Set();
    const start = drainHooks.size ? now() : 0;
    let count = 0;
    for (const c of queue) {
      c.run();
      count++;
    }
    if (drainHooks.size) {
      const durationMs = now() - start;
      for (const hook of drainHooks) hook('microtask', count, durationMs);
    }
  });
}

export const scheduler: Scheduler = {
  schedule,
  flush,
  flushMicrotask,
};

/** @internal — signals.ts's `batch()` uses this to open+drain the sync queue. */
export { withSyncFlush };
