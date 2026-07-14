# RFC-0005: Scheduler Design

- **Status:** Implemented
- **Depends on:** RFC-0004
- **Implements:** `runtime/scheduler.ts` (new); `runtime/signals.ts`'s
  `batch()` refactored onto it; `runtime/lifecycle.ts`'s
  `ComponentInstance.scheduleUpdated()` refactored onto it (all
  implemented and verified — see Verification)

## Summary

Introduce a dedicated scheduler module (`runtime/scheduler.ts`)
that owns flush timing, batching, and priority ordering for effect
execution — currently implicit and scattered across `batch()`'s manual
queue and each call site's assumption of synchronous execution. The
scheduler does **not** change the reactivity model's semantics (still
push-based, still synchronous-by-default); it centralizes the *timing*
decisions that model already implies, so future work (async effects,
`onUpdated` coalescing, input-response prioritization) has one place to
live instead of N ad-hoc implementations.

## Motivation

Today, `batch()` (`signals.ts`) is a hand-rolled micro-scheduler: it
collects triggered computations into a `Set`, then runs them in insertion
order once the batch callback returns. That's correct for its one job, but
two other places in the codebase have already grown their own timing logic
independently:

- `ComponentInstance.scheduleUpdated()` (`lifecycle.ts`) implements its own
  microtask-coalescing for `onUpdated`, separate from `batch()`.
- Nothing currently governs *ordering* when multiple independent signal
  writes outside a `batch()` trigger effects that touch overlapping DOM —
  today, "whatever order `Set` iteration gives" is the de facto answer.

The architecture review calls this out directly: "Introduce a dedicated
scheduler... nearly every mature framework eventually introduces one."
Doing this now, while the effect graph is still simple (RFC-0004's
Computation type, no async effects yet), is cheaper than doing it after
more subsystems have grown their own private timing logic.

## Design

### Responsibilities moved into the scheduler

```ts
interface Scheduler {
  schedule(computation: Computation, priority: Priority): void;
  flush(): void;                 // runs synchronously if called directly
  flushMicrotask(): void;        // schedules exactly one microtask flush
}

type Priority = 'sync' | 'microtask' | 'idle';
```

- **`sync`** — the default today: a signal write outside `batch()` flushes
  immediately, synchronously, to its direct subscribers. This preserves
  RFC-0004's "updates happen predictably relative to the write" guarantee
  and is NOT changed by this RFC — most Najm effects (DOM bindings) stay
  on this priority.
- **`microtask`** — replaces `ComponentInstance`'s bespoke
  `scheduleUpdated()` coalescing with the scheduler's own, so `onUpdated`
  and any future "batch of DOM writes, then notify once" consumer share
  one coalescing mechanism instead of each hand-rolling `queueMicrotask`.
  **Implementation note (deviation from the pseudocode above):**
  `ComponentInstance.scheduleUpdated()` coalesces "run every registered
  `onUpdated` hook," not a re-run of a single `Computation` — it has no
  `Computation` to hand to `schedule(computation, 'microtask')`. Rather
  than force a fake `Computation` through that signature,
  `runtime/scheduler.ts` factors the underlying "coalesce into at most
  one microtask" bookkeeping out as `createMicrotaskSlot(callback)`,
  which both `Scheduler.schedule`'s `'microtask'` branch (for actual
  `Computation`s, unused by anything in v1) and
  `ComponentInstance.scheduleUpdated()` (for its hook-array callback)
  build on. One mechanism, two thin call sites — the RFC's actual goal —
  rather than a signature-fidelity exercise.
- **`idle`** — reserved for future non-urgent work (e.g., a future
  speculative prefetch or background computed refresh); not consumed by
  anything in v1, specified now so the priority enum doesn't need a
  breaking change later. Present in the `Priority` type and handled (as a
  no-op) in `Scheduler.schedule`'s switch; nothing ever drains it yet.

### `batch()` becomes sugar over the scheduler

```ts
function batch<T>(fn: () => T): T {
  const result = fn(); // writes now call scheduler.schedule(..., 'sync')
                        // instead of running immediately
  scheduler.flush();   // one synchronous flush at the end
  return result;
}
```

Behaviorally identical to today's `batch()` — this is a refactor of where
the queueing logic lives, not a semantic change. The existing test
(`tests/test-signals.ts`'s `batch: many writes, one update wave`) is the
regression gate.

### Ordering guarantee

Within one flush, computations run in the order they were scheduled
(insertion order of the internal queue) — this matches today's `Set`
iteration behavior for the common case and makes it an explicit contract
instead of an accident of `Set`'s spec-defined iteration order. A
computation scheduled *during* a flush (e.g., a `computed` recomputing
triggers another effect) is appended to the same flush's queue rather than
starting a new one — this is what already happens today via `run()`'s
recursive re-entrancy and is preserved, not changed.

**Implementation note:** the internal queue actually implemented is a
`Set<Computation>` (`runtime/scheduler.ts`'s `syncQueue`), not a plain
array, for the same reason the pre-RFC `Batching` field was a `Set`: a
computation reachable from more than one write in the same flush (e.g.
subscribed to two signals both written in one `batch()`) must be enqueued
— and therefore run — only once. A `Set`'s `for...of` both preserves
insertion order and visits items added mid-iteration, which is what
delivers the "folded into the same flush" behavior for a nested
`schedule()` call without any extra bookkeeping. This was verified to be
behaviorally load-bearing, not just an implementation-detail carryover —
see the ordering and dedup tests below.

## Alternatives considered

- **Leave timing logic distributed (status quo).** Rejected: the
  `ComponentInstance`/`batch()` duplication already exists as of RFC-0002's
  lifecycle work; a third consumer (e.g., a future `debounce`-flavored
  effect) would be a third reimplementation. Centralizing now is cheaper
  than a later consolidation migration.
- **Fully async/lazy scheduling by default (React-style, all updates
  batched into a microtask automatically).** Rejected per RFC-0004: Najm's
  reactivity contract is synchronous-by-default specifically so compiled
  DOM bindings update predictably relative to the triggering write. Making
  `sync` priority the default preserves that; `microtask`/`idle` are
  explicit opt-ins for the specific cases that want coalescing.

## Verification

- **`batch()` is behavior-preserving.** `tests/test-signals.ts`'s
  `batch: many writes, one update wave` and `computed: derives and
  memoizes by result equality` (which batches two writes and asserts the
  downstream effect does NOT re-run) both pass unchanged after `batch()`
  became `withSyncFlush(fn)` — a thin wrapper over
  `runtime/scheduler.ts`'s sync queue. `npx tsx tests/test-signals.ts`:
  all 11 cases pass. **Done.**
- **`onUpdated` coalescing is behavior-preserving.**
  `tests/test-lifecycle.ts`'s `onUpdated: fires after graph changes,
  coalesced per microtask` and `onUpdated: batch produces one effect run
  and one update` both pass unchanged after
  `ComponentInstance.scheduleUpdated()` was migrated from a private
  `queueMicrotask()` call onto `scheduler.ts`'s `createMicrotaskSlot()`.
  `npx tsx tests/test-lifecycle.ts`: all 9 cases pass. **Done.**
- **Ordering guarantee, asserted explicitly.** `tests/test-scheduler.ts`
  (new, 6 cases) covers exactly what this RFC calls out as previously
  "incidental":
  - `ordering: two independent signal writes run effects in write order,
    not reversed` and the reversed-order companion case — three effects
    (two independent, one with a shared dependency on both signals);
    writing `a` then `b` outside `batch()` produces
    `['A:a1', 'AB:a1/b0', 'B:b1', 'AB:a1/b1']`, i.e. strictly write-order,
    confirmed in both write directions.
  - `nested trigger: a computation scheduled during a flush is folded
    into the same flush` — an effect that writes a second signal as a
    side effect of running (the "computed recomputing triggers another
    effect" case from the Design section) produces the downstream
    effect's re-run synchronously, in the same call stack, proving the
    nested `schedule()` call was folded into the in-progress flush rather
    than deferred.
  - `batch: coalesces multiple writes into exactly one flush per
    computation` and `batch: a computation triggered by multiple writes
    in the batch still runs once (dedup)` — three writes in one `batch()`
    produce exactly one re-run (not three), and a computation reachable
    from two of those writes still runs exactly once, confirming the
    `Set`-backed queue's dedup is preserved.
  - `sync priority: writes outside batch() still flush immediately` —
    confirms the `sync` default is still synchronous, no `await`/microtask
    needed to observe the effect's re-run.
  - `npx tsx tests/test-scheduler.ts`: all 6 cases pass. **Done.** No
    behavioral difference from today's `Set`-iteration ordering was found
    — the guarantee the RFC describes as "matches today's `Set` iteration
    behavior for the common case" holds exactly; this RFC makes it a
    tested contract rather than changing it.
- **Full suite.** `npm test` (`tests/test-signals.ts`,
  `test-lifecycle.ts`, `test-scheduler.ts`, `test-hoisting.ts`,
  `test-ir.ts`, `test-store.ts`, `test-router.ts`,
  `test-runtime-boundary.ts`) — 71 cases total, 100% pass. **Done.**
- **`npx tsc --noEmit`** — clean, no errors. **Done.**
- **Live/browser verification.** `npm run dev` + Playwright against
  `http://localhost:3000/`: `runtime/signals.ts` and
  `runtime/scheduler.ts`, served through Vite's real module graph (not
  Node's test runner), were exercised directly via
  `page.evaluate(...)`: a bare sync write re-ran its effect immediately
  (log showed the re-run before the write's own following statement
  executed), and a `batch()` of two writes produced exactly one re-run —
  confirming the scheduler behaves identically in the browser runtime.
  **Done, with a caveat:** the intended end-to-end path (clicking the
  TodoList island's checkbox in the live page and observing the "N left"
  badge update) could not be exercised, because hydrating
  `src/components/TodoList.najm` currently throws
  `[najm hydrate] expected a static element subtree, found text "Todos "
  — server HTML and client template are out of sync` — a pre-existing
  static-subtree/hoisting hydration bug in `runtime/hydrate.ts`'s
  template-claiming, unrelated to this RFC (it throws inside
  `view.hydrate(root)`, before any signal write or scheduler code runs;
  neither `runtime/hydrate.ts` nor the compiler's hoisting output were
  touched by this change). Confirmed via the browser console and by
  clicking the checkbox: the badge stayed at "3 left" because the
  island's JS never finishes attaching. This is a real, separate bug
  worth its own fix — flagged here rather than papered over — but it
  does not implicate the scheduler: the scheduler was verified directly
  against the live browser runtime instead, per above.

## Open questions

- Should `effect()` gain a `{ priority }` option so component authors can
  opt an individual effect into `microtask`/`idle` scheduling directly
  (e.g., a non-urgent analytics effect), or should that remain purely an
  internal mechanism the compiler/runtime uses (as with `onUpdated`)?
  Deferred until there's a concrete use case motivating the public API
  surface — RFC-0001's "no speculative configurability" applies here.
