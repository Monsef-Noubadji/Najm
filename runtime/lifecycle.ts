/**
 * Component lifecycle — Beta Phase 1
 * =================================================================
 * Najm has no render cycle, so its lifecycle cannot be defined in
 * terms of one. Instead it is defined against the two things that
 * actually exist: the DOM and the reactivity graph.
 *
 *   onMounted    — the instance's view is claimed/attached and live.
 *                  Never fires during SSR: mounting is a DOM event,
 *                  and the server has no DOM. (React took years of
 *                  useEffect-on-the-server confusion to relearn this.)
 *   onUpdated    — some effect owned by this instance re-ran. Fired
 *                  once per microtask, however many effects ran —
 *                  it observes the graph settling, not individual
 *                  DOM writes.
 *   onDestroyed  — the instance was unmounted; every owned effect is
 *                  already disposed when this fires.
 *
 * Registration uses the composition-API convention: hooks bind to the
 * instance whose setup function is CURRENTLY executing. That "current
 * instance" is a module-level stack, maintained by runWithInstance()
 * — which is exactly how Vue's getCurrentInstance and React's
 * dispatcher work under the hood; there is no magic, only a stack.
 */

import { createMicrotaskSlot, type MicrotaskSlot } from './scheduler';

type Hook = () => void;

export class ComponentInstance {
  mounted = false;
  private mountedHooks: Hook[] = [];
  private updatedHooks: Hook[] = [];
  private destroyedHooks: Hook[] = [];
  /**
   * RFC-0005: coalescing now goes through the scheduler's shared
   * `microtask`-priority mechanism (`createMicrotaskSlot`) instead of a
   * private `queueMicrotask` call — same "at most once per microtask"
   * behavior, one mechanism instead of two independent ones.
   */
  private readonly updateSlot: MicrotaskSlot = createMicrotaskSlot(() => {
    for (const fn of this.updatedHooks) runHook(fn, 'onUpdated');
  });

  onMounted(fn: Hook): void {
    this.mountedHooks.push(fn);
  }
  onUpdated(fn: Hook): void {
    this.updatedHooks.push(fn);
  }
  onDestroyed(fn: Hook): void {
    this.destroyedHooks.push(fn);
  }

  /** Called by the mounter once hydration completes. */
  markMounted(): void {
    this.mounted = true;
    for (const fn of this.mountedHooks) runHook(fn, 'onMounted');
  }

  /**
   * Called (via the effect observer) after any owned effect re-runs.
   * Coalesced per microtask: a batch() that touches ten bindings
   * produces ONE onUpdated, and the initial hydration pass (which runs
   * every effect once) produces none, because mounted is still false.
   */
  scheduleUpdated(): void {
    if (!this.mounted || this.updatedHooks.length === 0) return;
    this.updateSlot.request();
  }

  /** Called by the mounter after the instance's root scope is disposed. */
  runDestroyed(): void {
    for (const fn of this.destroyedHooks) runHook(fn, 'onDestroyed');
  }
}

function runHook(fn: Hook, name: string): void {
  try {
    fn();
  } catch (err) {
    console.error(`[najm] error in ${name} hook`, err);
  }
}

/* ---- the current-instance stack ---------------------------------- */

let current: ComponentInstance | null = null;

export function currentInstance(): ComponentInstance | null {
  return current;
}

/** Execute a component's setup function with `inst` as the hook target. */
export function runWithInstance<T>(inst: ComponentInstance, fn: () => T): T {
  const prev = current;
  current = inst;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/* ---- the public hook API ------------------------------------------ */

function requireInstance(hook: string): ComponentInstance {
  if (!current) {
    throw new Error(
      `[najm] ${hook}() called outside component setup — hooks must run ` +
        `synchronously inside the component function body`
    );
  }
  return current;
}

/** Runs once, on the client, after the view is hydrated and interactive. */
export function onMounted(fn: Hook): void {
  requireInstance('onMounted').onMounted(fn);
}

/** Runs (coalesced per microtask) after any of this instance's effects re-run. */
export function onUpdated(fn: Hook): void {
  requireInstance('onUpdated').onUpdated(fn);
}

/** Runs when the instance is unmounted, after all its effects are disposed. */
export function onDestroyed(fn: Hook): void {
  requireInstance('onDestroyed').onDestroyed(fn);
}
