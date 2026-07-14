# RFC-0017: Browser Compatibility

- **Status:** Accepted
- **Depends on:** the production build pipeline (`server/build.ts`,
  implemented — its client build target, `es2022`, is what this RFC
  formalizes as policy rather than an incidental default)

**Acceptance note.** Re-verified before acceptance: the API table below
was re-checked against `runtime/` after RFC-0009's plugin loader,
RFC-0011's CLI, and RFC-0012's language server all landed — none of that
work touches `runtime/` (plugins are compiler-side only, per RFC-0009's
own boundary; the CLI and LSP are Node-only tooling, never shipped to a
browser), so the same six files
(`client.ts`/`devtools-bridge.ts`/`hydrate.ts`/`lifecycle.ts`/
`scheduler.ts`/`store.ts`) remain the complete, accurate list of
browser-API-dependent modules. No new entries needed.

## Summary

Najm targets evergreen browsers only — no IE11-class legacy support, no
polyfill bundle, no transpilation below ES2022. This was already true
implicitly (the runtime uses `Proxy`, `<template>`/`cloneNode`,
`structuredClone`, `queueMicrotask`, and `IntersectionObserver` with no
fallback path for most of them); `server/build.ts`'s client build
already sets `target: 'es2022'` in its Vite/esbuild config. This RFC
makes that assumption an explicit, versioned policy instead of an
implicit one, and states plainly that it is a decision, not an oversight
to fix later with a polyfill bundle.

## Motivation

RFC-0001's small-core mandate and "ship JS only where interaction
requires it" philosophy are in direct tension with legacy-browser
support: every polyfill is bytes shipped to every user to cover browsers
an increasingly small fraction of users run, which is precisely the kind
of unconditional cost the whole architecture is designed to avoid. Rather
than silently accumulate that tension (a `Proxy` usage added in one RFC,
an `IntersectionObserver` added in another, neither revisited against a
stated policy), this RFC names the actual browser floor and the specific
APIs that set it, so a future PR adding a new browser API has something
concrete to check against instead of guessing.

## Design

### The floor: evergreen only, no polyfills, no fallback paths

```text
Chrome/Edge  last 2 years
Firefox      last 2 years
Safari       last 2 years (macOS + iOS)
```

No specific version pins — "last 2 years" ages automatically rather than
requiring this RFC to be revised on a schedule. No IE11, no legacy
Edge (EdgeHTML), no polyfill bundle shipped by default. A project that
genuinely needs older-browser support is expected to add its own
polyfills/transpilation in its own build config — Najm's compiler
(RFC-0003) and runtime don't attempt to detect or accommodate that case.

### Why: the specific APIs that already require this floor

Each is a hard requirement today, with no fallback path implemented —
not a "nice to have if available":

| API | Where | Why it's load-bearing |
| --- | --- | --- |
| `Proxy` | `runtime/store.ts` | The store's deep reactivity (RFC-0002) — the ENTIRE justification for choosing Proxy over per-field getters/setters was catching writes to keys that didn't exist at wrap-time (the Vue-2 failure mode). A `Proxy`-free fallback would have to reintroduce that exact bug or use a fundamentally different (and previously rejected) design. |
| `<template>` + `cloneNode` | `runtime/hydrate.ts` | AOT static hoisting's client-side clone path (RFC-0003) — the whole point is using the browser's fastest native DOM-construction primitive instead of `createElement`/`setAttribute` calls. A fallback would mean maintaining the slower path unconditionally, defeating the optimization for every browser to accommodate none. |
| `IntersectionObserver` | `runtime/client.ts` | `client:visible` partial hydration's trigger (RFC-0007). Already has a documented fail-open path (hydrate immediately if unavailable) — the ONE API on this list with a fallback, because "hydrate eagerly" is a correct, safe degradation, not a broken one. |
| `structuredClone` | `runtime/devtools-bridge.ts` | Time-travel snapshot cloning (RFC-0002). DevTools-only — never shipped to a production bundle that doesn't call `enableTimeTravel()`, so its floor requirement is scoped to opt-in developer tooling, not every end user. |
| `queueMicrotask` | `runtime/scheduler.ts`, `runtime/lifecycle.ts` | The scheduler's microtask-priority coalescing (RFC-0005) and `onUpdated`'s coalescing. Universally available in every evergreen browser for years; listed for completeness, not because it's a realistic compatibility risk. |

`IntersectionObserver` is the one entry that already demonstrates the
RIGHT pattern for handling an API that isn't universal within the
evergreen floor either (very old evergreen versions, embedded webviews):
fail open to the safe, correct default rather than silently doing
nothing. Future RFCs adding a new browser-dependent API should follow
that same pattern where a safe degradation exists, and should say so
explicitly in their own design (as RFC-0007 did) rather than leaving it
implicit.

### Build target: `es2022`, already real

`server/build.ts`'s client-side Vite/esbuild config sets `target:
'es2022'` (grep-confirmed in the actual build script) — this RFC adopts
that as the stated policy rather than an implementation default someone
could accidentally downgrade without noticing the compatibility
implication. `es2022` covers (non-exhaustive, the relevant ones): class
fields, top-level `await`, `.at()` — none of which the current runtime
uses yet, but the target is set to the modern floor deliberately, not
conservatively, matching "evergreen only."

### Compiler output: no separate legacy path

RFC-0003's codegen backends (SSR string builder, hydration claim-walk)
emit plain JS with no legacy-syntax accommodation — `compiler/codegen.ts`
generates code assuming the same ES2022 floor the build target enforces.
There is exactly one output shape per backend, not a modern/legacy split
(unlike, say, Vite's own default `.legacy` bundle pattern for other
frameworks) — consistent with RFC-0003's "two backends ship in v1, both
consuming the same IR" design; a third, legacy-targeting backend would
violate that and isn't planned.

## Alternatives considered

- **Ship a polyfill bundle, detect-and-load only when needed.** Rejected
  — even a conditionally-loaded polyfill means maintaining fallback code
  paths for `Proxy`/`<template>` that don't have a sane fallback (see the
  table above: a `Proxy` fallback isn't "slower," it's "reintroduces a
  known correctness bug"). The one API that DOES have a safe fallback
  (`IntersectionObserver`) already has one, without a bundle-detection
  mechanism — it's just a `typeof` check.
- **Transpile down to ES2018/ES2015 by default, let esbuild handle the
  syntax gap.** Rejected — syntax transpilation doesn't solve the actual
  problem (missing runtime APIs like `Proxy`/`IntersectionObserver`
  aren't a syntax issue esbuild's `target` can paper over), so it would
  add build complexity and bundle size for zero compatibility gain given
  the APIs actually in use.

## Verification

- The API table above is verified by direct `grep` against the current
  `runtime/*.ts` source — every listed usage is real and load-bearing,
  not aspirational (confirmed while authoring this RFC: `Proxy` in
  `store.ts`, `IntersectionObserver` in `client.ts`, `structuredClone` in
  `devtools-bridge.ts`, `queueMicrotask` in `scheduler.ts`/`lifecycle.ts`,
  `<template>`/`cloneNode` in `hydrate.ts`).
- `server/build.ts`'s `target: 'es2022'` is verified by direct
  inspection of the build script — this RFC does not introduce a new
  build setting, it names an existing one as policy.
- **Action item, not yet implemented**: no automated check exists yet
  that a future PR adding a new runtime API without a documented
  fallback gets flagged. Candidate: extend `tests/test-runtime-boundary.ts`
  (RFC-0002's existing static-analysis gate over `runtime/`) with a second
  check — a maintained allowlist of "known modern APIs with accepted
  compatibility rationale" (this RFC's table, machine-readable) that a
  new, un-listed modern-API usage would fail against, forcing a
  conscious update to this RFC's table rather than a silent addition.

## Open questions

- Should the "last 2 years" evergreen floor be pinned to specific
  Browserslist query syntax (`> 0.5%, last 2 versions, not dead`) for use
  in tooling (e.g., a future ESLint compat plugin, or Browserslist-aware
  bundler config)? Currently stated in prose only; revisit if/when a
  concrete tool needs a machine-readable query rather than a human-readable
  policy.
