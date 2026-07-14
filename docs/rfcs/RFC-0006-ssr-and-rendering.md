# RFC-0006: SSR & Rendering

- **Status:** Implemented
- **Depends on:** RFC-0002, RFC-0003
- **Formalizes:** `runtime/ssr.ts`, `server/dev.ts`
  (implemented); **adds:** error boundaries via `runtime/error-boundary.ts`'s
  `withErrorBoundary()` (implemented and verified — see Verification)

## Summary

Every page renders to an HTML string on the server via string
concatenation (no server-side Virtual DOM, nothing to diff — RFC-0003's
codegen backend emits `__html += ...` directly). A per-request
`RenderContext` collects component styles and island references during
that render; the server shell hoists styles into `<head>` and emits a
hydration bootstrap script *only if* islands were recorded. This RFC
formalizes that pipeline and specifies the error-boundary behavior the
review flagged as absent: today, a thrown error anywhere in a render
crashes the entire page with no isolation.

## Motivation

The current implementation (`server/dev.ts`'s `renderPage`) has
exactly one error-handling path: a `try`/`catch` around the *entire*
request that dumps a stack trace as a 500 response. That's acceptable for
a dev server showing a developer their own mistake, but it means one
broken island crashes the whole page, and there is no mechanism for a page
to say "if this component fails, render X instead and keep going." The
review lists this explicitly under "Error Boundaries": component
isolation, rendering errors, async errors, SSR failures — all currently
unhandled.

## Design

### Render pipeline (implemented, formalized here)

```text
1. beginRender()        — server, before invoking the page's ssr()
2. page.ssr(props)       — string concatenation; awaits component
                            includes (RFC-0003's async codegen)
3. endRender()           — yields { islands, styles } collected during
                            the render
4. shell(body, ctx)      — wraps body in <html>, hoists styles into
                            <head>, emits ONE hydration script IF AND
                            ONLY IF islands.length > 0
```

A page with zero interactive components produces zero framework
JavaScript in its response — this is not an optimization applied after
the fact, it is what not recording any `IslandRef`s during the render
naturally produces.

### Error boundaries (implemented)

A component opts into being an error boundary by wrapping itself with a
runtime helper, `withErrorBoundary` (`runtime/error-boundary.ts`):

```ts
type OnError = (error: unknown, phase: 'ssr' | 'hydrate') => string; // fallback HTML

function withErrorBoundary(
  comp: FunctionalComponent,
  onError: OnError
): FunctionalComponent;
```

`withErrorBoundary(comp, onError)` returns a new `FunctionalComponent`
whose `ssr()`/`hydrate()` wrap `comp`'s own — including the call to
`comp(props)` itself, since a functional component's body is its setup
phase (RFC-0002) and setup + first render are one inseparable pass; a
guard clause that throws before a component's `return { template }` is
exactly as much "this component's ssr() failed" as a throw inside the
compiled `ssr()` closure, and both are caught. A component that is not
wrapped propagates its error exactly like today — there is no ambient,
unnamed boundary at the SSR level (unlike hydration, see below); if
nothing wraps a failing component, the error reaches the page level and
the server's top-level `try`/`catch` (unchanged from today) handles it.

Boundary scope, precisely:

- **SSR-phase errors** — caught inside the wrapper's own `ssr()`, before
  the failure ever reaches the `renderComponent`/`renderIsland` call site
  (`ssr.ts`). Those two functions do not add their own try/catch — see
  their doc comments — so a wrapped component's fallback HTML is just
  what `ssr()` resolves to, spliced into the page in place of the failed
  component's output exactly like a successful render would be; the rest
  of the page renders normally. An unwrapped component's throw still
  propagates all the way to the server's outer `try`/`catch`, preserving
  today's "fail the whole request" behavior for anyone who didn't opt in
  — this RFC adds isolation, it does not remove the outer safety net.
- **Hydration-phase errors** — two layers, both real:
  1. `hydrateIslands` (`client.ts`) already wraps every island's
     `hydrate()` call in its own `try`/`catch` (implemented, unchanged) —
     a failing island logs and leaves its SSR'd HTML in place, inert,
     rather than taking down other islands on the page. This RFC
     formalizes that as "the default, unnamed error boundary every
     island already has."
  2. `withErrorBoundary`'s `hydrate()` wrapper adds a second, opt-in
     layer on top: it catches, calls `onError(error, 'hydrate')` for
     reporting parity with the SSR phase (so a caller-supplied `onError`
     observes both phases as the type signature promises), and then
     re-throws — deliberately leaving the actual DOM-safety action (leave
     the SSR'd markup inert) to `client.ts`'s existing per-island catch,
     rather than having two independent mechanisms race to mutate the
     same island's DOM. See "Judgment call" below.
- **Async errors inside an effect** (post-hydration, e.g., a rejected
  promise inside `effect()`) are out of scope for this RFC — they are a
  reactivity-graph concern (RFC-0004/RFC-0005), not a rendering concern,
  and are deferred to whichever of those RFCs' revisions takes it up.

**Judgment call — hydrate-phase fallback does not touch the DOM.** The
task of "what does a boundary do when hydrate() fails" has two candidate
answers: (a) splice `onError()`'s HTML into the island's DOM via
`innerHTML`, mirroring the SSR-phase behavior, or (b) catch, report, and
let the existing per-island isolation in `client.ts` leave the SSR'd
output inert. This implementation chose (b). Reasoning: `client.ts`
already performs the one safety action a hydration failure needs — the
page stays visually correct because the SSR'd HTML is still there, just
non-interactive — and it does so for *every* island, wrapped or not, so
it cannot be skipped. Having `withErrorBoundary` also rewrite the DOM
would mean two independent recovery paths touching the same subtree for
a wrapped island (which one wins is a race), and would make a wrapped
island behave differently from an unwrapped one in a way that isn't
about isolation — it's about whether the page shows "the button that no
longer works" or "an error message where the button used to be," a
product decision this RFC does not need to make unilaterally. Giving
`onError` the callback either way (`ssr` and `hydrate` both invoke it)
keeps the reporting/logging contract uniform without duplicating the one
DOM mutation that matters.

### What this RFC does NOT add

- No client-side error-boundary component wrapper (React's
  `<ErrorBoundary>`) — Najm has no children/slots yet (noted as a v0.1
  limitation in the current implementation), so a boundary is currently
  expressed at the single-component level (a component catches its own
  render errors), not as a wrapper around arbitrary child content. Slot
  support is a prerequisite for a wrapping-style boundary and is tracked
  as a follow-up, not blocking this RFC.

## Alternatives considered

- **Global error handler only (status quo).** Rejected — the review is
  explicit that component isolation is required, and a single global
  handler cannot express "this one island failing shouldn't affect
  siblings," which is already partially true today for hydration
  (per-island `try`/`catch` in `client.ts`) but not for SSR.
- **Compiler-recognized `catch` block instead of a runtime wrapper.**
  Considered and deferred — see "Open questions" below for the resolution:
  the runtime wrapper (`withErrorBoundary`) is what shipped.

## Verification

- Unit tests (`tests/test-error-boundary.ts`, 9 cases, run via `npm test`):
  a `withErrorBoundary`-wrapped component whose `ssr()` throws does not
  propagate — the wrapper's `ssr()` resolves to the `onError` fallback
  string instead; a wrapped component whose `ssr()` succeeds passes
  through unchanged and `onError` is never called; the same two cases
  again through `renderComponent()` (the real call site pages compile
  against); an **unwrapped** component's `ssr()` throw still propagates
  (proving isolation is opt-in, not a global default); `onError` receives
  the actual thrown `Error` instance (not a stringified copy) and the
  correct phase string; a throw during the component's **setup phase**
  (before `ssr()` even exists as a closure — e.g. a guard clause before
  `return { template }`) is caught too, not just throws from inside the
  compiled `ssr()` body; a wrapped `hydrate()` throw is caught, calls
  `onError(error, 'hydrate')`, and then rethrows for `client.ts`'s
  existing per-island isolation to handle (see the Design section's
  judgment call); a healthy wrapped `hydrate()` passes through unchanged.
  **Done — all 9 pass.**
- Live, end-to-end, verified against a running dev server
  (`src/pages/error-boundary-demo.najm`, `src/components/Crasher.najm`,
  `src/components/SafeCrasher.ts`): `Crasher` throws synchronously in its
  setup phase when given `bad="yes"`. Wrapped in `withErrorBoundary` and
  rendered twice on the same page — once with the bad prop, once without
  — `GET /error-boundary-demo` returns **HTTP 200** (not 500), and the
  response body contains `<div class="crasher-fallback" data-phase="ssr">
  Something went wrong rendering this component — showing a fallback
  instead.</div>` in place of the crashed instance, immediately followed
  by the healthy instance's real markup (`<div class="crasher-ok"><p>
  Crasher rendered fine — bad was falsy.</p></div>`) — proving isolation
  within a single page, not just across requests. The dev server's own
  log shows `onError` fired with the real `Error` object (`Crasher:
  refusing to render with bad="yes"`, stack trace pointing at the
  component's `throw` line) and phase `'ssr'`. Checked in-browser via
  Playwright: no console errors, page title/content render correctly.
  An unrelated existing page (`/`, with its `TodoList` island) and a
  zero-island page (`/about`) were loaded in the same session immediately
  after and both rendered normally with zero console errors — `/`'s
  island hydrated (`[najm] TodoList mounted — island is interactive`
  logged), and `/about`'s response body still contains no `<script>` tag,
  confirming this change does not regress the general render path or the
  zero-JS-by-default guarantee. **Done.**
- Zero-island pages still ship zero `<script>` tags — regression check
  against `/about`, reconfirmed above. **Done.**

## Open questions

- ~~Runtime wrapper (`withErrorBoundary`) vs. compiler-recognized
  `catch` — which ships first?~~ **Resolved: the runtime wrapper shipped
  first**, per this RFC's own stated lean. `withErrorBoundary` lives
  entirely in `runtime/error-boundary.ts` and required zero RFC-0003
  compiler/codegen changes — `renderComponent`/`renderIsland` in
  `ssr.ts` are unmodified in control flow (only documented), because a
  wrapped component's `ssr()` already resolves to fallback HTML like any
  other successful render by the time it reaches those call sites. The
  compiler-recognized `catch` block sugar remains a possible later
  ergonomic addition, and is more motivated once slots exist and
  boundaries commonly wrap multiple children rather than guarding a
  single component's own render (see "What this RFC does NOT add" above)
  — not blocking, not scheduled.
