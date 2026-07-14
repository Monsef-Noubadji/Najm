# RFC-0004: Reactivity System

- **Status:** Implemented
- **Depends on:** RFC-0001
- **Formalizes:** `runtime/signals.ts` (implemented, tested —
  `tests/test-signals.ts`, 11 passing cases)

## Summary

Najm's reactivity is a push-based, fine-grained signal graph: `Signal`
(value + subscriber set) and `Computation` (function + the subscriber sets
it's registered in), tracking dependencies by construction rather than
declaration. This is deliberately in the SolidJS / Preact Signals /
MaverickJS tradition, per the architecture review's explicit guidance —
**not** a port of Angular Signals.

## Motivation

The review scored the runtime architecture 9/10 and said explicitly:
"Signals should remain the core primitive... avoid copying Angular Signals
implementation directly." The implementation that exists already follows
Solid's model (push-based propagation, an ownership tree distinct from the
dependency-tracking mechanism, synchronous-by-default effects) rather than
Angular's (which is pull-based/lazy with an internal dirty-marking
scheduler pass). This RFC exists to make that lineage explicit and binding,
since earlier documentation loosely described the design as "Solid/Angular"
without distinguishing which ideas came from which framework.

## Design

### Primitives

```ts
signal<T>(value: T): Signal<T>
computed<T>(fn: () => T): ReadonlySignal<T>
effect(fn: () => void): Cleanup
batch<T>(fn: () => T): T
untrack<T>(fn: () => T): T
onCleanup(fn: Cleanup): void
```

`Signal.value` is a getter/setter accessor (Preact Signals' ergonomic
choice, not Solid's `[get, set]` tuple) — chosen specifically because it
makes two-way binding symmetric: the compiler reads `sig.value` into an
input and writes `sig.value` from the input's event handler, one mental
model both directions (see RFC-0007 for the generated binding code).

### Dependency tracking: by construction, not declaration

```text
Listener: Computation | null   — "who is reading me right now"
Owner:    Computation | null   — "who disposes me when they're disposed"
```

These are separate globals (Solid's insight, documented in
`signals.ts`'s header): tracking answers "who re-runs when I change,"
ownership answers "who cleans me up." A `computed()` create inside a
`createRoot()` scope is *owned* by that root (dies when the root disposes)
but is *tracked* by whatever effect later reads it — the two questions
have different answers for the same computation, which a single global
cannot represent.

Reading `signal.value` while `Listener` is non-null subscribes that
computation to the signal — no dependency array, no manual declaration.
Because tracking re-runs from scratch on every execution (`reset()` clears
prior subscriptions before re-running), branches that stop being taken stop
being dependencies automatically — this is the standard "dynamic
dependency" behavior Solid, Vue 3, and MobX all converged on, and it is
what makes `untrack()` (suppress tracking without breaking ownership) and
`batch()` (coalesce multiple writes into one flush) correct without extra
bookkeeping.

### Equality gating and memoization

Every signal write is gated by `Object.is` — writing the same value is a
no-op, full stop. `computed()` is built as a signal kept fresh by an
internal effect; the equality gate on that internal signal's write is what
gives `computed()` its memoization "for free" — a computed's recompute can
run without its downstream consumers re-running, if the recomputed value is
unchanged. This was verified directly: `tests/test-signals.ts`'s
`computed: derives and memoizes by result equality` test asserts a
downstream effect does NOT re-run when two upstream writes cancel out to
the same computed result.

### Ownership tree (ties into RFC-0002)

`createRoot(fn)` runs `fn` in a fresh scope that owns (but does not track)
everything created inside it, returning a single `dispose()` that tears
down every owned computation recursively. This is the mechanism RFC-0002's
component mount/unmount and context system are built on — it is specified
here because it is fundamentally a reactivity-graph property, not a
component-model property; RFC-0002 references this section rather than
re-specifying it.

### What Najm does NOT take from Angular Signals

- No `Zone.js`-style ambient change detection — there is no zone patching
  `setTimeout`/`addEventListener` to trigger checks. Effects run
  synchronously when their dependencies change (or once per batch), full
  stop.
- No pull-based/lazy "dirty" flag requiring an explicit read to discover
  staleness. Najm's signals push eagerly, synchronously, to their direct
  subscribers — deliberately, because compiled DOM bindings need updates
  to happen predictably relative to the write that caused them, not on the
  next tick or the next read.
- No decorator-based (`@Input`, `@Component`) primitive surface — signals
  are plain function calls, consistent with RFC-0001's compiler-first,
  small-core philosophy.

## Alternatives considered

- **Angular's pull-based model with an explicit `markDirty`/check pass.**
  Rejected per the review's explicit guidance and because it doesn't suit
  a compiler that emits per-binding effects — those effects need to fire
  synchronously on write, not wait for an external check cycle.
- **Solid's `[get, set]` tuple API instead of `.value`.** Considered, but
  `.value` accessors make the generated two-way-binding code
  (`bind:value={sig}` → read `sig.value`, write `sig.value` from an
  event) symmetric in a way tuples don't naturally give without extra
  compiler-side bookkeeping of which variable name is the getter vs.
  setter.

## Verification

Already implemented and passing (`tests/test-signals.ts`, 11 cases):
read/write/peek, dependency tracking and re-run, equality no-ops, dynamic
dependency swapping, disposal, computed memoization, batching, untrack,
ownership-tree disposal on re-run, `onCleanup` ordering, signal
auto-unwrapping (`get()`).

## Open questions

- Should `computed()` become lazy (only recompute on read, not eagerly via
  an internal effect) once the scheduler (RFC-0005) exists? Currently
  eager-via-effect is simpler and already gives correct memoization
  semantics; laziness would be a pure performance optimization, evaluated
  against real profiling data, not assumed necessary.
