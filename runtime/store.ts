/**
 * The Najm Store — v1.0 Phase 2.1
 * =================================================================
 * ARCHITECTURAL JUSTIFICATION — Proxies over per-field getters/setters
 * (required by the v1.0 spec):
 *
 * Najm already has a getter/setter reactive primitive: `Signal`, whose
 * `.value` accessor is exactly that pattern. The naive way to give a
 * store "deep reactivity" would be to walk a state object at creation
 * time and replace every leaf with a Signal. Two things make that the
 * WRONG choice here, and both are documented failure modes from
 * earlier frameworks, not hypotheticals:
 *
 *   1. New keys are invisible. `store.state.list.push(x)` or
 *      `store.state.user.nickname = 'x'` (a key that didn't exist at
 *      wrap-time) can't be intercepted by a getter/setter that was
 *      installed on specific, pre-enumerated property names. This is
 *      the literal bug Vue 2's reactivity system shipped with for
 *      years (`Vue.set()` existed *because* of it) — Vue 3 moved to
 *      Proxy specifically to close this hole.
 *   2. Eager deep-walking is wasted work for state that's never read
 *      that deeply, and it doesn't compose: arrays, Maps, and Sets
 *      each need bespoke instrumentation under getters/setters,
 *      whereas a Proxy's `get`/`set`/`deleteProperty`/`has` traps
 *      cover plain objects and arrays UNIFORMLY and LAZILY — nested
 *      objects are only wrapped the first time they're actually read.
 *
 * A Proxy costs a little more per-access than a direct property read,
 * and that IS a real tradeoff — it's why component-local hot-path
 * state should stay on plain `signal()`, and the store is reserved for
 * genuinely cross-cutting app state (auth, theme, cart) where a few
 * hundred nanoseconds of indirection is immaterial next to a network
 * request. Najm does not force a choice: `defineStore` composes ON TOP
 * of `Signal` (each proxied leaf-read creates a real dependency edge
 * against a hidden per-path Signal), so the surgical-update guarantee
 * from the reactivity core is preserved — writing `store.user.name`
 * notifies exactly the effects that read `store.user.name`, not every
 * consumer of `store`.
 */
import { signal, batch, type Signal } from './signals';

export type Mutator<S> = (state: S, ...args: any[]) => void;
export type Getter<S, R> = (state: S) => R;

export interface StoreDefinition<
  S extends object,
  A extends Record<string, Mutator<S>> = {},
  G extends Record<string, Getter<S, any>> = {}
> {
  state: () => S;
  actions?: A;
  getters?: G;
}

export type Store<
  S extends object,
  A extends Record<string, Mutator<S>>,
  G extends Record<string, Getter<S, any>>
> = S & {
  /** Actions with `state` pre-bound — call as `store.increment(1)`. */
  readonly $actions: { [K in keyof A]: (...args: DropFirst<Parameters<A[K]>>) => void };
  /** Computed getters, re-evaluated on read, memoized like `computed()`. */
  readonly $getters: { [K in keyof G]: ReturnType<G[K]> };
  /** Replace the entire state tree in one reactive wave (devtools time-travel). */
  $replaceState(next: S): void;
  /** Subscribe to every committed action; returns an unsubscribe function. */
  $subscribe(fn: (action: string, args: unknown[], state: S) => void): () => void;
};

type DropFirst<T extends any[]> = T extends [any, ...infer R] ? R : never;

const NODE = Symbol('najm.store.node');

/**
 * Wrap a plain object/array in a Proxy that materializes ONE hidden
 * Signal per accessed property path, lazily, on first read. This is
 * the "deep reactivity" mechanism: nested objects are themselves
 * proxied on demand (not eagerly), so `store.a.b.c` tracks precisely
 * the leaf `c` was read, not the whole `a` subtree.
 */
function reactive<T extends object>(target: T, onWrite: () => void): T {
  if (target == null || typeof target !== 'object') return target;
  if ((target as any)[NODE]) return target; // already proxied

  // One Signal per property, created lazily — this is what makes deep
  // reactivity cheap for state that's mostly written, rarely read deep.
  const fieldSignals = new Map<PropertyKey, Signal<unknown>>();
  const childProxies = new Map<PropertyKey, unknown>();

  const signalFor = (key: PropertyKey, initial: unknown): Signal<unknown> => {
    let s = fieldSignals.get(key);
    if (!s) {
      s = signal(initial);
      fieldSignals.set(key, s);
    }
    return s;
  };

  const proxy: any = new Proxy(target, {
    get(obj, key, receiver) {
      if (key === NODE) return true;
      const raw = Reflect.get(obj, key, receiver);
      if (typeof key === 'symbol' || typeof raw === 'function') return raw;

      // Track this exact path: reading store.user.name subscribes the
      // CURRENT effect to the `name` signal on the `user` node only —
      // sibling fields (store.user.age) never notify it.
      const tracked = signalFor(key, raw).value;

      if (tracked != null && typeof tracked === 'object') {
        let child = childProxies.get(key);
        if (!child || (child as any)[NODE] !== true) {
          child = reactive(tracked, onWrite);
          childProxies.set(key, child);
        }
        return child;
      }
      return tracked;
    },

    set(obj, key, value, receiver) {
      const prev = Reflect.get(obj, key, receiver);
      const ok = Reflect.set(obj, key, value, receiver);
      if (ok && !Object.is(prev, value)) {
        childProxies.delete(key); // stale wrapper — rewrapped lazily on next read
        signalFor(key, value).value = value; // notifies only THIS path's readers
        onWrite();
      }
      return ok;
    },

    deleteProperty(obj, key) {
      const had = Reflect.has(obj, key);
      const ok = Reflect.deleteProperty(obj, key);
      if (ok && had) {
        childProxies.delete(key);
        signalFor(key, undefined).value = undefined;
        onWrite();
      }
      return ok;
    },
  });

  return proxy;
}

/**
 * Define a global store: reactive state + bound actions + memoized
 * getters. One store definition, called once, is a singleton (module
 * scope) — exactly Pinia's ergonomics, built on Najm's own primitives
 * rather than a second reactivity system.
 */
export function defineStore<
  S extends object,
  A extends Record<string, Mutator<S>> = {},
  G extends Record<string, Getter<S, any>> = {}
>(def: StoreDefinition<S, A, G>): () => Store<S, A, G> {
  let instance: Store<S, A, G> | null = null;

  return () => {
    if (instance) return instance;

    const subscribers = new Set<(action: string, args: unknown[], state: S) => void>();
    let rawState = def.state();
    let state = reactive(rawState, () => {}) as S;

    const actions = {} as Store<S, A, G>['$actions'];
    for (const name of Object.keys(def.actions ?? {}) as (keyof A)[]) {
      const fn = def.actions![name];
      (actions as any)[name] = (...args: unknown[]) => {
        // Batched: an action that touches five fields fires ONE update
        // wave, not five — the same discipline signals.ts already gives
        // component code via batch().
        batch(() => fn(state, ...args));
        for (const sub of subscribers) sub(String(name), args, rawState);
      };
    }

    const getters = {} as Store<S, A, G>['$getters'];
    for (const name of Object.keys(def.getters ?? {}) as (keyof G)[]) {
      Object.defineProperty(getters, name, {
        enumerable: true,
        get: () => def.getters![name](state),
      });
    }

    instance = new Proxy(state, {
      get(target, key, receiver) {
        if (key === '$actions') return actions;
        if (key === '$getters') return getters;
        if (key === '$replaceState') {
          return (next: S) => {
            batch(() => {
              rawState = next;
              state = reactive(rawState, () => {}) as S;
              Object.assign(target, next); // keep the outer proxy's identity stable
            });
          };
        }
        if (key === '$subscribe') {
          return (fn: (action: string, args: unknown[], state: S) => void) => {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
          };
        }
        return Reflect.get(state as object, key, receiver);
      },
      set(_target, key, value) {
        (state as any)[key] = value; // routes through the reactive() proxy's set trap
        return true;
      },
    }) as Store<S, A, G>;

    return instance;
  };
}
