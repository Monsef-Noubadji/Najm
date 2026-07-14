/**
 * DevTools flush-timing — RFC-0010 (DevTools Protocol)
 * =================================================================
 * `enableFlushTiming()` wraps `scheduler.ts`'s two actual drain loops —
 * `drainSync()` (the engine behind `batch()`/bare synchronous writes) and
 * `flushMicrotask()`'s queue drain — timing each one and broadcasting a
 * `FlushEvent` per drain, via `scheduler.ts`'s `__addDrainHook` seam. That
 * seam is the ONE thing this module touches in scheduler.ts: a small Set
 * of registered callbacks, checked with one `if (drainHooks.size)`,
 * invoked with the count of computations that ran and the elapsed time —
 * see its doc comment in scheduler.ts. `schedule()` (the queueing side)
 * is completely untouched, matching the RFC's "not their queueing side...
 * wrap the drain loops" instruction.
 *
 * SCOPE NOTE: a bare (non-batched) signal write outside `batch()` runs
 * its subscribers immediately via `computation.run()` in `schedule()`'s
 * `else` branch — it never enters `drainSync()`'s queue loop at all (see
 * scheduler.ts's `schedule()`), so it produces no `FlushEvent`. This
 * matches the RFC's framing of `drainSync()`/`flushMicrotask()` as "the"
 * two drain points to instrument: a `FlushEvent` reports on a QUEUED
 * drain (`batch()`, or any `'microtask'`-priority schedule), not on every
 * individual synchronous write, which has no queue to time.
 */
import { __addDrainHook, type Priority } from './scheduler';

export interface FlushEvent {
  priority: 'sync' | 'microtask' | 'idle';
  computationCount: number;
  durationMs: number;
}

/**
 * Enable flush timing: broadcasts one `najm-devtools:flush` message per
 * `drainSync()`/`flushMicrotask()` drain that actually ran (a drain with
 * zero queued computations is skipped — nothing happened worth reporting).
 * Returns a disposer that unregisters the hook and stops broadcasting.
 */
export function enableFlushTiming(): () => void {
  const removeHook = __addDrainHook((priority: Priority, computationCount: number, durationMs: number) => {
    if (computationCount === 0) return;
    const event: FlushEvent = { priority, computationCount, durationMs };
    broadcast({ type: 'najm-devtools:flush', ...event });
  });

  let disposed = false;
  return function disable(): void {
    if (disposed) return;
    disposed = true;
    removeHook();
  };
}

/** Fire-and-forget postMessage, matching devtools-bridge.ts's broadcast(). */
function broadcast(msg: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'najm-devtools-bridge', ...msg }, '*');
  }
}
