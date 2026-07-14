/**
 * DevTools signal-graph inspector — RFC-0010 (DevTools Protocol)
 * =================================================================
 * `enableGraphInspector()` decorates the public `signal()`/`computed()`/
 * `effect()` exports so every one created while enabled is tagged with a
 * stable numeric id and registered. It does NOT modify signals.ts's
 * internals or its hot path (`Signal.value`'s get/set, `Computation.run()`)
 * — the only signals.ts surface this module touches is:
 *
 *   - `createSignal`/`createComputed`/`createEffect` — the real factory
 *     implementations, exported `@internal` so this module's wrappers can
 *     delegate to them (ES module bindings are read-only from outside the
 *     defining module, so `signal()` itself cannot be monkey-patched from
 *     here — signals.ts instead exposes one swappable indirection point,
 *     `__setFactories`, that `signal()`/`computed()`/`effect()` call
 *     through; see that function's doc comment in signals.ts). This costs
 *     one extra function call per `signal()`/`computed()`/`effect()` call
 *     — construction time, not the per-read/per-write hot path.
 *   - `Computation._devtoolsInspect()` / `Signal._devtoolsSubs()` —
 *     read-only accessors onto fields that already exist (`parent`,
 *     `deps`, `owned`, `subs`); see their doc comments in signals.ts.
 *
 * Every dependency edge in `dependsOn` comes from a Computation's
 * existing `deps: Set<Set<Computation>>` — this module reads that
 * structure (mapping each subscriber-Set back to the Signal id that owns
 * it) rather than tracking dependencies a second time.
 *
 * BROADCAST TRIGGER (judgment call — the RFC leaves this open): a
 * snapshot is broadcast after every RUN of an instrumented computation —
 * both its creation and every subsequent re-run, via broadcastAfterRun()
 * wrapping the body passed to effect()/computed() — plus once more after
 * any scheduler drain that ran at least one computation, piggybacking on
 * the `__addDrainHook` seam `devtools-timing.ts` also uses in
 * scheduler.ts (both modules may be enabled independently and
 * simultaneously — the hook is a Set, not a single slot). The per-run
 * broadcast is what makes this work for BARE (non-batched) writes like
 * `bind:checked`'s `sig.value = el.checked` — a real checkbox click in
 * this codebase's demo app — which never enter the scheduler's drain
 * loop at all; the drain-hook broadcast alone would silently miss them
 * (see broadcastAfterRun's doc comment for how this was discovered).
 * This mirrors `enableTimeTravel`'s choice to broadcast on every
 * committed action rather than on a timer or manual pull — a DevTools
 * panel wants the graph as of the last user-visible update. `snapshot()`
 * is also exported directly for a consumer (or a test) that wants the
 * current graph on demand without waiting for a broadcast.
 */
import {
  createSignal,
  createComputed,
  createEffect,
  currentOwner,
  __setFactories,
  Signal,
  Computation,
  type Cleanup,
  type ReadonlySignal,
} from './signals';
import { __addDrainHook } from './scheduler';

export interface GraphSnapshot {
  signals: Array<{ id: number; label?: string; value: unknown }>;
  computations: Array<{
    id: number;
    kind: 'effect' | 'computed';
    dependsOn: number[];
    ownedBy: number | null;
  }>;
}

/**
 * Enable signal-graph inspection: wraps `signal()`/`computed()`/`effect()`
 * (via signals.ts's `__setFactories` indirection) so every one created
 * from here on is tagged with a stable id and registered. Returns a
 * disposer that restores the original factories (nothing further gets
 * tagged), un-registers the drain hook, and stops broadcasting. Signals/
 * computations already tagged are simply forgotten, not retroactively
 * un-instrumented — matches the RFC's Open Questions note that late
 * attach is out of scope for v1 (this module only ever instruments calls
 * made while enabled).
 */
export function enableGraphInspector(opts?: { label?: (signal: unknown) => string }): () => void {
  let nextSignalId = 1;
  let nextComputationId = 1;
  const signalById = new Map<number, { signal: Signal<unknown>; label?: string }>();
  const computationById = new Map<number, { computation: Computation; kind: 'effect' | 'computed' }>();
  const signalIdBySubs = new WeakMap<Set<Computation>, number>();
  const computationIdByRef = new WeakMap<Computation, number>();

  function registerSignal(s: Signal<unknown>): void {
    const id = nextSignalId++;
    signalIdBySubs.set(s._devtoolsSubs(), id);
    const entry: { signal: Signal<unknown>; label?: string } = { signal: s };
    if (opts?.label) {
      try {
        entry.label = opts.label(s);
      } catch {
        // a broken label() must never break the app it's inspecting
      }
    }
    signalById.set(id, entry);
  }

  function registerComputation(c: Computation, kind: 'effect' | 'computed'): void {
    const id = nextComputationId++;
    computationIdByRef.set(c, id);
    computationById.set(id, { computation: c, kind });
  }

  /**
   * Find the Computation that `effect()`/`computed()` just created by
   * diffing the enclosing owner's `owned` list before/after — neither
   * function returns the Computation itself (see module doc). Falls back
   * to a lazily-created synthetic root when called with no enclosing
   * owner (a top-level call outside any `createRoot()`), purely so the
   * diff has somewhere to land; this changes nothing about how the app's
   * own effects behave or dispose.
   */
  let fallbackOwner: Computation | null = null;
  let fallbackDispose: Cleanup | null = null;
  function withOwnedDiff<T>(run: () => T): { result: T; created: Computation | null } {
    let owner = currentOwner() as unknown as { _devtoolsInspect(): ReturnType<Computation['_devtoolsInspect']> } | null;
    if (!owner) {
      if (!fallbackOwner) {
        const root = createRootForFallback();
        fallbackOwner = root.owner;
        fallbackDispose = root.dispose;
      }
      owner = fallbackOwner as unknown as { _devtoolsInspect(): ReturnType<Computation['_devtoolsInspect']> };
    }
    const before = owner._devtoolsInspect().owned;
    const beforeCount = before.length;
    const result = run();
    const after = owner._devtoolsInspect().owned;
    const created = after.length > beforeCount ? after[after.length - 1] : null;
    return { result, created };
  }

  const wrappedSignal = <T,>(value: T): Signal<T> => {
    const s = createSignal(value);
    registerSignal(s as unknown as Signal<unknown>);
    return s;
  };

  const wrappedComputed = <T,>(fn: () => T): ReadonlySignal<T> => {
    // Broadcast after every re-run too (not just after a queued drain —
    // see broadcastAfterRun's doc comment), by wrapping the body itself;
    // Computation.run() calls this same closure on every re-run, so this
    // is additive to `fn`, not a change to how/when it runs.
    const { result, created } = withOwnedDiff(() => createComputed(broadcastAfterRun(fn)));
    registerSignal(result as unknown as Signal<unknown>);
    if (created) registerComputation(created, 'computed');
    return result;
  };

  const wrappedEffect = (fn: () => void): Cleanup => {
    const { result, created } = withOwnedDiff(() => createEffect(broadcastAfterRun(fn)));
    if (created) registerComputation(created, 'effect');
    return result;
  };

  /**
   * Wrap an effect/computed body so a snapshot broadcasts after every run
   * (creation AND every subsequent re-run) — not just after a scheduler
   * drain. This is what makes a BARE (non-batched) signal write, like
   * `bind:checked`'s `sig.value = el.checked` (the checkbox-click case
   * this RFC's Verification explicitly targets), produce a broadcast: a
   * bare write runs its subscriber directly via `computation.run()`,
   * never entering `drainSync()`'s queue loop at all (see scheduler.ts's
   * `schedule()`), so the drain-hook broadcast alone would miss it. Does
   * NOT use `withEffectObserver` (which would hijack `EffectObserver`
   * for the call's duration and could silently steal `onUpdated`'s
   * observer slot from a component's own effects) — wrapping the body
   * closure is a strictly additive change to *what this computation
   * does*, not to any ownership/observer plumbing.
   */
  function broadcastAfterRun<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: Parameters<T>) => {
      const result = fn(...args);
      // A computation created before disable() keeps this wrapped body
      // forever (bodies aren't retroactively un-wrapped — see the
      // disposer's doc comment), so this live check is what actually
      // stops it from broadcasting once disabled, not just the registry
      // clear below (which only empties the CONTENT of any snapshot,
      // not whether one fires at all).
      if (!disposed) broadcastSnapshot();
      return result;
    }) as T;
  }

  __setFactories({ signal: wrappedSignal, computed: wrappedComputed, effect: wrappedEffect });

  function buildSnapshot(): GraphSnapshot {
    const signals: GraphSnapshot['signals'] = [];
    for (const [id, entry] of signalById) {
      signals.push({
        id,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
        value: entry.signal.peek(),
      });
    }
    const computations: GraphSnapshot['computations'] = [];
    for (const [id, entry] of computationById) {
      const inspect = entry.computation._devtoolsInspect();
      const dependsOn: number[] = [];
      for (const subs of inspect.deps) {
        const sid = signalIdBySubs.get(subs);
        if (sid !== undefined) dependsOn.push(sid);
      }
      const ownedBy = inspect.parent ? computationIdByRef.get(inspect.parent) ?? null : null;
      computations.push({ id, kind: entry.kind, dependsOn, ownedBy });
    }
    return { signals, computations };
  }

  activeSnapshotFn = buildSnapshot;

  function broadcastSnapshot(): void {
    broadcast({ type: 'najm-devtools:graph-snapshot', graph: buildSnapshot() });
  }

  // Belt-and-suspenders: every computation this module creates already
  // broadcasts after its own run via broadcastAfterRun (above), which is
  // what covers bare (non-batched) writes. This hook additionally covers
  // any drain scenario broadcastAfterRun wouldn't (e.g. the very first
  // run's broadcast landing before that computation is registered — see
  // broadcastAfterRun's ordering note): one more broadcast right after a
  // drain finishes ensures the snapshot a DevTools panel sees is never
  // more than one drain stale.
  const removeDrainHook = __addDrainHook((_priority, computationCount) => {
    if (computationCount > 0) broadcastSnapshot();
  });

  let disposed = false;
  return function disable(): void {
    if (disposed) return;
    disposed = true;
    __setFactories(null);
    removeDrainHook();
    if (activeSnapshotFn === buildSnapshot) activeSnapshotFn = null;
    fallbackDispose?.();
    signalById.clear();
    computationById.clear();
  };
}

/**
 * Build and return the current graph without needing a flush to happen —
 * a manual escape hatch for a consumer (or test) that wants the graph
 * right now. Only meaningful while `enableGraphInspector()` is active;
 * returns an empty graph otherwise since nothing is tagged.
 */
let activeSnapshotFn: (() => GraphSnapshot) | null = null;

export function snapshot(): GraphSnapshot {
  return activeSnapshotFn ? activeSnapshotFn() : { signals: [], computations: [] };
}

/* ------------------------------------------------------------------ */
/* internal plumbing                                                   */
/* ------------------------------------------------------------------ */

/** Fire-and-forget postMessage, matching devtools-bridge.ts's broadcast(). */
function broadcast(msg: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'najm-devtools-bridge', ...msg }, '*');
  }
}

/**
 * Lazily create the synthetic fallback root (see withOwnedDiff's doc
 * comment) using the REAL createEffect/currentOwner (not the wrapped
 * versions, which aren't installed yet at the point this needs to run —
 * and shouldn't be, since this scope isn't part of the app's own graph).
 */
function createRootForFallback(): { owner: Computation; dispose: Cleanup } {
  // A zero-op effect creates exactly one Computation and installs it as
  // Owner for the (synchronous) duration of its run — enough to capture
  // a stable, disposable owner to diff against for later top-level calls.
  let owner!: Computation;
  const dispose = createEffect(() => {
    owner = currentOwner() as unknown as Computation;
  });
  return { owner, dispose };
}
