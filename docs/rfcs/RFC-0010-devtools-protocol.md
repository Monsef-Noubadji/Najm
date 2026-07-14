# RFC-0010: DevTools Protocol

- **Status:** Implemented
- **Depends on:** RFC-0002 (context/lifecycle), RFC-0004 (signals), RFC-0005 (scheduler)
- **Formalizes:** `runtime/devtools-bridge.ts` (implemented — the store
  time-travel half); **implements:** the signal-graph and update-timing
  half, in `runtime/devtools-graph.ts` and `runtime/devtools-timing.ts`

## Summary

A wire protocol, carried over `window.postMessage`, between a running
Najm app and a DevTools panel (browser extension, RFC-0013). Three
inspectable surfaces: the store's action/time-travel history (already
implemented via `enableTimeTravel`), the live signal dependency graph
(new), and update timing (new — depends on RFC-0005's scheduler, which
now exists and is what unblocks this RFC). All three ride the same
message envelope and are each independently opt-in: instrumenting a
signal graph costs real overhead (every `Computation`'s dependency set
becomes inspectable, which means retaining information the reactivity
core doesn't otherwise need), so none of it exists in a production build
unless a page explicitly enables it.

## Motivation

`runtime/devtools-bridge.ts`'s `enableTimeTravel` already proves the
mechanism: `postMessage({ source: 'najm-devtools-bridge', ... })`, zero
DOM dependency beyond a `window` check, so it works headless in tests and
does nothing in a non-browser SSR context. What's missing is the other
two things the architecture review's DevTools entry names explicitly:
"inspect the Signal graph, component hierarchy, and measure update
performance." Time-travel covers store-level history; it does not show
*which* signals a given effect depends on, *which* component owns a given
effect, or *how long* a flush took. Those require instrumentation inside
`signals.ts` and `scheduler.ts` that doesn't exist today — reasonably so,
since adding it unconditionally would cost every user of the reactivity
core, whether or not they ever open DevTools.

## Design

### Message envelope (extends the existing pattern)

```ts
interface DevToolsMessage {
  source: 'najm-devtools-bridge';
  type: string;   // e.g. 'najm-devtools:action', 'najm-devtools:graph-snapshot'
  [key: string]: unknown;
}
```

`enableTimeTravel`'s `broadcast()` already emits this shape
(`najm-devtools:action`, `najm-devtools:jump`); this RFC adds new `type`
values rather than a new transport. A DevTools extension's content script
listens for `source === 'najm-devtools-bridge'` and dispatches on `type`
— one listener, growing message vocabulary, no protocol version
negotiation needed yet (see Open Questions).

### Signal graph inspection (new)

```ts
interface GraphSnapshot {
  signals: Array<{ id: number; label?: string; value: unknown }>;
  computations: Array<{
    id: number;
    kind: 'effect' | 'computed';
    dependsOn: number[];    // signal ids read during the last run
    ownedBy: number | null; // parent computation id, or null (root)
  }>;
}

function enableGraphInspector(opts?: { label?: (signal: unknown) => string }): () => void;
```

`enableGraphInspector()` is a separate opt-in from `enableTimeTravel`
(different cost profile — this one touches the reactivity core itself,
not just a store). It works by wrapping `signal()`/`computed()`/`effect()`
at the call site the app uses (RFC-0002/0004's existing exports), tagging
each created `Signal`/`Computation` with a stable numeric id and pushing
it into a registry. Every dependency edge already exists at runtime (a
`Computation`'s `deps: Set<Set<Computation>>` — see `signals.ts`); the
inspector reads that structure rather than duplicating it, which is why
this RFC is gated on the reactivity core already existing and stable
(RFC-0004) rather than needing changes to it.

`ownedBy` reads the same parent-pointer RFC-0002's context system walks
(`Computation.parent`, internal to `signals.ts`, not part of the general
public API). This is what lets a DevTools panel group effects under the
component instance that created them, matching RFC-0002's "ownership tree
IS the component hierarchy for mounted instances" framing.

**Implementation note — how "decorate the public API" is actually
achieved.** ES module exports are read-only bindings: `devtools-graph.ts`
cannot reassign `signals.ts`'s exported `signal`/`computed`/`effect`
functions from outside the module that defines them, so true
call-site-transparent monkey-patching isn't possible in JS. `signals.ts`
instead exposes one small, swappable indirection point —
`__setFactories()` — that `signal()`/`computed()`/`effect()` call through
internally, defaulting to the real implementations
(`createSignal`/`createComputed`/`createEffect`, also exported
`@internal` so an instrumented override can still delegate to the real
behavior). `enableGraphInspector()` is the only caller of
`__setFactories()`. This costs one extra function call per
`signal()`/`computed()`/`effect()` invocation — construction time, not
the `Signal.value` get/set or `Computation.run()` hot path, which are
untouched. The disposer restores the default factories, so a
Signal/Computation created before enabling (or after disabling) is never
wrapped.

Neither `effect()` nor `computed()` returns the `Computation` it creates
(`effect()` returns only a disposer; `computed()` returns only the
derived `Signal`) — by design, `Computation` isn't public API. To
identify the just-created `Computation` anyway, the inspector diffs the
enclosing owner's `owned` list (also exposed read-only, alongside `deps`
and `parent`, via one `Computation._devtoolsInspect()` accessor) before
and after calling the real factory. A call made with no enclosing owner
(outside any `createRoot()`) lazily opens one internal synthetic root as
a place for the diff to land — this doesn't change how the app's own
effects behave or dispose, it only gives top-level instrumentation calls
an owner to diff against.

**Judgment call — broadcast trigger.** The RFC text originally left this
open. The implementation broadcasts `najm-devtools:graph-snapshot` after
**every run** of an instrumented computation (creation and every
subsequent re-run), not only after a scheduler drain. This matters
concretely: a `bind:checked` two-way binding writes its backing signal
directly (`sig.value = el.checked`), outside `batch()` — a bare,
non-batched write runs its subscriber immediately via
`computation.run()` in `scheduler.ts`'s `schedule()`, never entering
`drainSync()`'s queue loop at all. A drain-only broadcast trigger would
silently miss the single most common real interaction in the demo app (a
checkbox click) — confirmed by live browser verification below, where
the first implementation (broadcast-on-drain only) produced zero
messages for a real checkbox click. The fix wraps each instrumented
computation's body in a small closure that broadcasts after `fn()`
returns, whatever caused it to run. A second broadcast still fires from
`scheduler.ts`'s drain hook (see Update timing below) as a fallback for
the one case per-run broadcasting can't cover — the very first run's
broadcast lands before that computation is registered (the owned-list
diff happens after the factory call returns), so the drain-hook
broadcast, firing once more right after the drain finishes, ensures the
snapshot a panel sees is never more than one drain stale.

**Documented limitation — no late attach.** `enableGraphInspector()`
only tags Signals/Computations created **after** it's called. A
Signal/Computation created before enabling (e.g., a component that
mounted before DevTools was opened) is invisible to the inspector for
its lifetime — confirmed live: clicking a pre-existing TodoList checkbox
(created before `enableGraphInspector()` ran) produced zero messages,
while creating a fresh signal/effect pair after enabling and toggling it
produced correct, complete `graph-snapshot` broadcasts. This matches the
Open Questions note below: late attach isn't supported in v1.

### Update timing (new, depends on RFC-0005)

```ts
interface FlushEvent {
  priority: 'sync' | 'microtask' | 'idle';
  computationCount: number;
  durationMs: number;
}

function enableFlushTiming(): () => void;
```

Wraps `scheduler.ts`'s `drainSync()`/`flushMicrotask()` drain loops (not
their queueing side — timing cares about "how long did running these
computations take," not "when were they queued") to emit one
`FlushEvent` per drain, broadcast as `najm-devtools:flush`. This is the
concrete capability RFC-0005 unblocks: before the scheduler existed,
"measure update performance" had no single drain point to instrument —
`batch()` and `ComponentInstance.scheduleUpdated()` were two independent
hand-rolled queues (RFC-0005's own Motivation section), so timing either
of them didn't tell you about the other. Now there is one `drainSync()`
and one `flushMicrotask()` to wrap.

**Implementation note.** Neither drain function is exported by
`scheduler.ts` (only the `scheduler.flush`/`scheduler.flushMicrotask`
object methods are, and — checked directly — nothing in `signals.ts` or
`lifecycle.ts` actually calls through those object methods for a real
drain: `batch()` calls `withSyncFlush` directly, and a bare sync write
calls `computation.run()` directly, bypassing `scheduler.flush()`
entirely; `flushMicrotask()` is similarly called as a bare module-local
function, not `scheduler.flushMicrotask`). Wrapping the exported object
methods from outside the module, as a literal reading of "decorate the
public API" might suggest, would therefore observe nothing. Instead,
`scheduler.ts` exposes one small seam, `__addDrainHook()`, adding a
callback to a `Set` invoked at the end of `drainSync()`/`flushMicrotask()`
with `(priority, computationCount, durationMs)`. The `Set` (rather than a
single nullable slot) is what lets `enableGraphInspector()` and
`enableFlushTiming()` both register a drain hook independently and
simultaneously without one silently overwriting the other. Cost when no
hook is registered: one `if (drainHooks.size)` check per drain — same
cost class as the pre-existing `if (syncQueue)` checks already on this
path.

**Documented scope boundary.** A `FlushEvent` reports on a *queued*
drain. A bare (non-batched) signal write has no queue to time — it runs
its subscriber synchronously in `schedule()`'s `else` branch — so it
produces no `FlushEvent`, only `batch()` (any `'sync'`-queued drain) and
any `'microtask'`-priority schedule do. Confirmed live: a real checkbox
click (`bind:checked`, a bare write) produced zero `najm-devtools:flush`
messages, while a `batch()` of two writes to a shared dependency produced
exactly one, with `computationCount: 1` and a real sub-millisecond
`durationMs` from `performance.now()`.

### What this RFC does NOT add

- No new DOM/component-tree walking — component hierarchy is *derived*
  from the ownership tree above (a mounted component's root scope, per
  RFC-0002's `createRoot()`), not tracked as a separate structure.
- No protocol versioning/handshake — see Open Questions.
- The actual DevTools panel UI (RFC-0013, browser extension) is a
  separate RFC; this one specifies only the wire protocol and the
  app-side instrumentation that produces it.

## Alternatives considered

- **A single `enableDevTools()` turning on everything at once.** Rejected
  — time-travel, graph inspection, and flush timing have different cost
  profiles (a store subscription vs. wrapping every `signal()` call vs.
  wrapping two scheduler drain points), and a user debugging a store
  issue shouldn't pay the graph-inspector's overhead. Three independent
  opt-ins, one shared message envelope.
- **Instrument `signals.ts`/`scheduler.ts` internals directly, always-on
  behind a module-level flag.** Rejected — this would mean the hot path
  (every signal read/write) carries a branch check even when DevTools is
  never opened, however cheap. Decorating the public API in a separate
  module keeps `Signal.value`'s get/set and `Computation.run()` — the
  actual hot path — byte-for-byte unchanged; the factory-call indirection
  (`__setFactories`) and the drain-hook `Set` (`__addDrainHook`) are both
  outside that path, costing only construction time and end-of-drain
  time respectively, and both are a single cheap guard
  (`if (drainHooks.size)`) when nothing is registered.

## Verification

- `enableGraphInspector()` (`tests/test-devtools.ts`): a `createRoot()`
  with a parent effect owning two child effects (same shape as
  `test-signals.ts`'s "ownership" test) produces a `GraphSnapshot` whose
  `computations` array reflects that ownership via `ownedBy`, and whose
  `dependsOn` arrays match the signals each effect actually reads (the
  parent depends only on the signal it reads; each child depends only on
  its own signal, not its sibling's). A separate test confirms `computed()`
  is tagged `kind: 'computed'`, distinct from a plain `effect()`. **Done.**
- `enableFlushTiming()` (`tests/test-devtools.ts`): a `batch()` of two
  writes to signals sharing one dependent computation produces exactly
  one `FlushEvent` with `computationCount: 1` — the same
  dedup/coalescing fixture shape as `tests/test-scheduler.ts`'s "batch: a
  computation triggered by multiple writes... still runs once" test, with
  the *reported* count asserted against the actual run count. A second
  test confirms three independent computations triggered by one `batch()`
  report `computationCount: 3`. **Done.**
- Both disposers actually stop broadcasting/wrapping: calling either
  returned disposer, then performing an action that would have
  broadcast, produces zero new messages — including the disposer-timing
  edge case where a computation created *before* disposal still exists
  and re-runs afterward (its wrapped body checks a live "still enabled"
  flag rather than relying solely on registry state). **Done**, including
  a regression test that a Signal/Computation created *after* `disable()`
  is not tagged at all (proves `signal()`/`computed()`/`effect()` are
  genuinely restored, not just silenced). **Done.**
- Structural zero-overhead check (full benchmark still blocked on
  RFC-0014, which doesn't exist yet): confirmed neither `signals.ts` nor
  `scheduler.ts` needed any change to their actual hot paths
  (`Signal.value`'s get/set, `Computation.run()`, `schedule()`'s queueing
  branch). The changes made — `Computation._devtoolsInspect()` /
  `Signal._devtoolsSubs()` (read-only accessors on existing fields),
  `signals.ts`'s `__setFactories()` indirection (one extra call at
  `signal()`/`computed()`/`effect()` construction time only), and
  `scheduler.ts`'s `__addDrainHook()` `Set` (one `if (drainHooks.size)`
  check at the end of each drain) — are all either read-only, gated
  behind an empty-by-default check, or outside the per-read/per-write
  path. **Done** (structural); the runtime-cost benchmark itself remains
  deferred to RFC-0014 as originally noted.
- Live browser verification, against the running dev server's `/` page
  (the TodoList island, real signal writes from real DOM events), via
  Playwright driving a real Chromium instance: injected
  `enableGraphInspector()`/`enableFlushTiming()` through a live import of
  `/runtime/index.ts`, listened for real `window.postMessage` events.
  **Done** — observed, with actual captured payloads:
  - A freshly created signal + effect (created after enabling, to work
    within the documented no-late-attach limitation) produced correct
    `najm-devtools:graph-snapshot` messages on both creation and a bare
    write, e.g. `{ source: 'najm-devtools-bridge', type:
    'najm-devtools:graph-snapshot', graph: { signals: [{ id: 1, value: 1
    }], computations: [{ id: 1, kind: 'effect', dependsOn: [1], ownedBy:
    null }] } }`.
  - A `batch()` of two writes to that signal produced exactly one
    `najm-devtools:flush` message: `{ source: 'najm-devtools-bridge',
    type: 'najm-devtools:flush', priority: 'sync', computationCount: 1,
    durationMs: 0 }` — one event, `computationCount` reflecting the one
    distinct computation that ran, not the two writes.
  - Clicking a **pre-existing** TodoList checkbox (mounted before
    `enableGraphInspector()` was called) produced **zero** messages —
    the live confirmation of the documented no-late-attach limitation,
    not a bug: that signal/effect pair was created before instrumentation
    was installed.
  - After calling both disposers, writing to the still-live instrumented
    signal produced zero further messages.

## Open questions

- Protocol versioning: if `DevToolsMessage`'s shape changes in a future
  revision, how does an old extension talk to a new app (or vice versa)?
  Deferred until there's a second version to actually negotiate — RFC-0018
  (Public API Stability) is the more natural home for a general answer,
  once it exists.
- Should `enableGraphInspector()` be able to attach *after* signals
  already exist (e.g., opened mid-session from a running app), or only
  at startup before any `signal()` calls? Attaching late means the
  registry can't retroactively tag already-created signals without
  `signals.ts` cooperating more than the "decorate the public API"
  approach allows — likely means startup-only for v1, revisit if a real
  use case (attach DevTools to an already-running production tab) comes up.
