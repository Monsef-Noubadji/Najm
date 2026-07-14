/**
 * Najm Reactivity Core
 * =================================================================
 * Fine-grained reactivity in the SolidJS / Preact Signals tradition —
 * see docs/rfcs/RFC-0004-reactivity-system.md for why this is deliberately
 * NOT a port of Angular Signals (no zones, no pull-based dirty checking).
 *
 * The entire model is two data structures pointing at each other:
 *
 *   Signal      — holds a value + a Set of Computations that read it.
 *   Computation — a function + a Set of the signal-subscriber-Sets
 *                 it currently appears in.
 *
 * DEPENDENCY TRACKING works by construction, not by declaration:
 * while a Computation's function runs, it is installed as the global
 * `Listener`. Any `signal.value` read during that window subscribes
 * the computation to that signal. No dependency arrays, no
 * `shouldComponentUpdate`, no diffing — the graph *is* the truth.
 *
 * SURGICAL UPDATES fall out of this: writing a signal re-runs only
 * the computations that read it. In Najm's compiled output, each
 * dynamic text node / attribute gets its *own* tiny effect, so a
 * state change touches exactly the DOM nodes that display it.
 * There is no Virtual DOM because there is nothing to diff — we
 * already know precisely what changed.
 */

import { scheduler, withSyncFlush } from './scheduler';

export type Cleanup = () => void;

/** The computation currently executing (the "who is reading me?" answer). */
let Listener: Computation | null = null;

/**
 * The computation that OWNS newly created computations. Split from
 * `Listener` in Beta (the Solid insight): ownership answers "who
 * disposes me?", tracking answers "who re-runs on my reads?". A root
 * scope owns without tracking; `untrack` suppresses tracking without
 * orphaning children.
 */
let Owner: Computation | null = null;

/**
 * Beta lifecycle plumbing: while set, every computation created captures
 * this callback and invokes it after each re-run. The component mounter
 * uses it to drive `onUpdated` — the hook is literally attached to the
 * reactivity graph, not to a render cycle (there is no render cycle).
 */
let EffectObserver: (() => void) | null = null;

/**
 * A reactive scope. `effect()` and `computed()` are both built on this.
 * Exported as a type only — scheduler.ts needs it for `Scheduler.schedule`'s
 * signature but must not construct or otherwise reach into one; the
 * reactivity graph stays entirely owned by this module.
 */
export class Computation {
  /** Every subscriber-Set (one per signal) this computation is registered in. */
  private deps = new Set<Set<Computation>>();
  /** Computations created while this one ran — they die when we re-run/dispose. */
  private owned: Computation[] = [];
  /** User cleanups registered via `onCleanup()`. */
  private cleanups: Cleanup[] = [];
  private disposed = false;
  /** v1.0: the scope that created this one — lets context walk UP the tree. */
  private readonly parent: Computation | null;
  /** v1.0: context values provided directly on this scope (see context.ts). */
  private contextValues: Map<symbol, { value: unknown }> | null = null;

  /** Post-run notifier (inherited down the ownership tree) — see onUpdated. */
  readonly observer: (() => void) | null;

  constructor(private readonly fn: () => void) {
    // Inherit the observer: effects created later inside a re-running
    // parent (e.g. new list rows) must still report into the same
    // component instance that hydrated them.
    this.observer = EffectObserver ?? Owner?.observer ?? null;
    this.parent = Owner;
    // Ownership tree: a nested computation belongs to the computation
    // that created it. When the parent re-runs (e.g. a list re-renders),
    // stale child effects are disposed automatically — no bookkeeping.
    if (Owner) Owner.owned.push(this);
  }

  /** @internal — context.ts: publish a value on this scope. */
  provide(id: symbol, value: unknown): void {
    if (!this.contextValues) this.contextValues = new Map();
    this.contextValues.set(id, { value });
  }

  /** @internal — context.ts: find the nearest ancestor (or self) providing `id`. */
  lookup(id: symbol): { value: unknown } | undefined {
    let node: Computation | null = this;
    while (node) {
      const found = node.contextValues?.get(id);
      if (found) return found;
      node = node.parent;
    }
    return undefined;
  }

  /** @internal — signals call this to (re)subscribe us. */
  _track(subs: Set<Computation>): void {
    subs.add(this);
    this.deps.add(subs);
  }

  run(): void {
    if (this.disposed) return;
    // Dynamic dependencies: wipe last run's subscriptions so a branch
    // that is no longer taken stops triggering us.
    this.reset();
    const prevListener = Listener;
    const prevOwner = Owner;
    Listener = this;
    Owner = this;
    try {
      this.fn();
    } finally {
      Listener = prevListener;
      Owner = prevOwner;
    }
    // Report the run to the owning component instance (onUpdated).
    if (!this.disposed) this.observer?.();
  }

  private reset(): void {
    for (const subs of this.deps) subs.delete(this);
    this.deps.clear();
    for (const child of this.owned.splice(0)) child.dispose();
    for (const clean of this.cleanups.splice(0)) {
      try {
        clean();
      } catch (err) {
        console.error('[najm] error in onCleanup handler', err);
      }
    }
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
  }

  addCleanup(fn: Cleanup): void {
    this.cleanups.push(fn);
  }

  /**
   * @internal RFC-0010 devtools-graph.ts ONLY. Read-only exposure of the
   * ownership pointer, dependency-subscriber-sets, and owned-children list
   * that already exist on every Computation (see the class doc) — not
   * part of the general public API, not used by context.ts (which gets
   * its own narrower `OwnerHandle` via `currentOwner()`). `owned` lets the
   * inspector discover a just-created child Computation by diffing this
   * list around a wrapped `effect()`/`computed()` call, since neither
   * function returns the Computation itself (only a disposer / the
   * derived Signal) — see devtools-graph.ts's module doc. Exists so the
   * graph inspector can read structure that already exists at runtime
   * instead of duplicating it; touches nothing about how a Computation
   * runs or is tracked.
   */
  _devtoolsInspect(): {
    parent: Computation | null;
    deps: ReadonlySet<Set<Computation>>;
    owned: readonly Computation[];
  } {
    return { parent: this.parent, deps: this.deps, owned: this.owned };
  }
}

/**
 * A writable reactive value. Read `.value` to subscribe (when inside an
 * effect), write `.value` to notify. `.peek()` reads without subscribing.
 *
 * We use the `.value` accessor style (Vue refs / Preact signals) rather
 * than Solid's getter tuples because it makes two-way binding symmetric:
 * the compiler reads `sig.value` into the input and writes `sig.value`
 * back out of the input event — one mental model in both directions.
 */
export class Signal<T> {
  protected _value: T;
  protected readonly subs = new Set<Computation>();

  constructor(value: T) {
    this._value = value;
  }

  /**
   * @internal RFC-0010 devtools-graph.ts ONLY. Read-only exposure of the
   * subscriber Set that already exists on every Signal (see the class
   * doc) — lets the inspector map a Computation's `deps` entries (each a
   * reference to one of these `subs` Sets) back to the Signal id that
   * owns it, without signals.ts needing to know about ids or registries.
   */
  _devtoolsSubs(): Set<Computation> {
    return this.subs;
  }

  get value(): T {
    // THE tracking moment: whoever is currently running gets subscribed.
    if (Listener) Listener._track(this.subs);
    return this._value;
  }

  set value(next: T) {
    // Equality gate: writing the same value is a no-op. This is also what
    // stops `computed` from cascading when its result didn't change.
    if (Object.is(next, this._value)) return;
    this._value = next;
    // Copy before iterating — running a computation mutates `subs`
    // (it unsubscribes and resubscribes itself).
    const toRun = [...this.subs];
    // 'sync' priority: outside batch()/a flush, scheduler.schedule runs
    // each computation immediately (see scheduler.ts) — identical to the
    // old `for (const c of toRun) c.run()`. Inside batch(), it queues
    // instead, and batch()'s flush() drains once at the end.
    for (const c of toRun) scheduler.schedule(c, 'sync');
  }

  /** Read the current value without creating a dependency. */
  peek(): T {
    return this._value;
  }

  /** Functional write: `todos.update(list => [...list, item])`. */
  update(fn: (prev: T) => T): void {
    this.value = fn(this._value);
  }
}

export type ReadonlySignal<T> = Omit<Signal<T>, 'value' | 'update'> & {
  readonly value: T;
};

/** @internal — devtools-graph.ts: the real implementation, to call from an instrumented override. */
export function createSignal<T>(value: T): Signal<T> {
  return new Signal(value);
}

/** @internal — devtools-graph.ts: the real implementation, to call from an instrumented override. */
export function createComputed<T>(fn: () => T): ReadonlySignal<T> {
  const s = new Signal<T>(undefined as T);
  createEffect(() => {
    s.value = fn();
  });
  return s as ReadonlySignal<T>;
}

/** @internal — devtools-graph.ts: the real implementation, to call from an instrumented override. */
export function createEffect(fn: () => void): Cleanup {
  const c = new Computation(fn);
  c.run();
  return () => c.dispose();
}

/**
 * RFC-0010: one indirection point per factory, defaulting to the real
 * implementations above. `enableGraphInspector()` (runtime/devtools-graph.ts)
 * is the only thing that ever reassigns these — ES module bindings are
 * otherwise read-only from outside the defining module, so this is the
 * one seam that lets that module "decorate the public API" without
 * signals.ts knowing anything about ids, registries, or devtools at all.
 * The indirection costs one extra function call per `signal()`/`computed()`/
 * `effect()` call — construction time, not the `Signal.value`/
 * `Computation.run()` hot path, which is untouched.
 */
let signalImpl: typeof createSignal = createSignal;
let computedImpl: typeof createComputed = createComputed;
let effectImpl: typeof createEffect = createEffect;

/** @internal — devtools-graph.ts: swap in/out instrumented factories. */
export function __setFactories(overrides: {
  signal?: typeof createSignal;
  computed?: typeof createComputed;
  effect?: typeof createEffect;
} | null): void {
  signalImpl = overrides?.signal ?? createSignal;
  computedImpl = overrides?.computed ?? createComputed;
  effectImpl = overrides?.effect ?? createEffect;
}

/** Create a writable signal. */
export function signal<T>(value: T): Signal<T> {
  return signalImpl(value);
}

/**
 * Create a derived, read-only signal. Implemented as a signal kept fresh
 * by an effect — the equality gate in the setter means downstream
 * subscribers only re-run when the *result* actually changes, which is
 * the memoization that matters.
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return computedImpl(fn);
}

/**
 * Run `fn` now and again whenever any signal it read changes.
 * Returns a disposer. This is the only bridge between the reactive
 * graph and the outside world (the DOM, in Najm's case).
 */
export function effect(fn: () => void): Cleanup {
  return effectImpl(fn);
}

/** Register a cleanup that runs before the enclosing effect re-runs or dies. */
export function onCleanup(fn: Cleanup): void {
  if (Listener) Listener.addCleanup(fn);
}

/** Read signals inside `fn` without subscribing the current effect to them. */
export function untrack<T>(fn: () => T): T {
  const prev = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = prev;
  }
}

/**
 * Coalesce many writes into one update wave: effects triggered inside
 * the batch run once at the end, not once per write.
 *
 * Sugar over the scheduler (RFC-0005): writes inside `fn` call
 * `scheduler.schedule(computation, 'sync')`, which queues instead of
 * running immediately while a sync flush is open; `withSyncFlush` opens
 * that flush for the duration of `fn` and drains it once `fn` returns.
 * Behaviorally identical to the old hand-rolled `Batching` Set — see
 * `tests/test-signals.ts`'s "batch: many writes, one update wave".
 */
export function batch<T>(fn: () => T): T {
  return withSyncFlush(fn);
}

/** True if `x` is a Signal (used by the compiler's auto-unwrap helper). */
export function isSignal(x: unknown): x is Signal<unknown> {
  return x instanceof Signal;
}

/**
 * Auto-unwrap: the compiler wraps every template expression in `get()`,
 * so `{count}` works whether `count` is a signal or a plain value —
 * and, crucially, reading it inside an effect still tracks.
 */
export function get<T>(x: T | Signal<T>): T {
  return x instanceof Signal ? x.value : x;
}

/* ------------------------------------------------------------------ */
/* Beta additions — scopes & lifecycle plumbing                        */
/* ------------------------------------------------------------------ */

/**
 * Run `fn` inside a fresh ownership scope that TRACKS NOTHING but OWNS
 * everything created within it. This is how a component instance gets a
 * single disposal handle for every effect its view ever creates —
 * `unmount()` is one `dispose()` call, not a walk.
 */
export function createRoot<T>(fn: () => T): { result: T; dispose: Cleanup } {
  const scope = new Computation(() => {});
  const prevListener = Listener;
  const prevOwner = Owner;
  Listener = null; // reads inside the scope must NOT re-run the scope
  Owner = scope;
  try {
    return { result: fn(), dispose: () => scope.dispose() };
  } finally {
    Listener = prevListener;
    Owner = prevOwner;
  }
}

/**
 * v1.0: the currently-active owner scope, exposed opaquely for
 * context.ts's provide()/inject() — the only two operations context
 * needs are "publish on me" and "look up from me", both already
 * methods on Computation.
 */
export interface OwnerHandle {
  provide(id: symbol, value: unknown): void;
  lookup(id: symbol): { value: unknown } | undefined;
}

export function currentOwner(): OwnerHandle | null {
  return Owner;
}

/**
 * Every computation created while `fn` runs (and, via inheritance,
 * every computation those later create) reports each re-run to
 * `observer`. The mounter uses this to schedule `onUpdated`.
 */
export function withEffectObserver<T>(observer: () => void, fn: () => T): T {
  const prev = EffectObserver;
  EffectObserver = observer;
  try {
    return fn();
  } finally {
    EffectObserver = prev;
  }
}
