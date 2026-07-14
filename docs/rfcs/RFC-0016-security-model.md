# RFC-0016: Security Model

- **Status:** Implemented
- **Depends on:** RFC-0009 (Plugin API, Implemented — the plugin trust
  surface this RFC specifies), RFC-0006 (SSR, request-isolation
  guarantee this RFC specifies and — see below — found violated and fixed)

## Summary

Three security-relevant guarantees, each tied to real code:

1. **XSS-safety of the compiler's escaping rules** — `escapeHtml`/
   `escapeAttr` (`runtime/escape.ts`) and the narrowly-scoped, unescaped
   `{@html}` primitive (`compiler/parse.ts`, restricted to server-only
   layout composition per its own doc comment).
2. **SSR request-isolation** — no per-request state leaking across
   concurrent renders. **This RFC's authoring found this guarantee
   VIOLATED in real, shipped, "Implemented"-status code**: `runtime/ssr.ts`'s
   `RenderContext` was a single module-level `let ctx` variable, corrupted
   by concurrent requests under real, reproducible conditions. Fixed as
   part of this RFC (see Verification) — `runtime/ssr.ts` now uses Node's
   `AsyncLocalStorage` for genuine per-request isolation.
3. **Plugin supply-chain trust** — what a `NajmPlugin`'s `transformIR`/
   `codegen` hooks (RFC-0009) can and cannot do to a compile, now that a
   real plugin loader exists to reason about.

## Motivation

This RFC's original stub deferred everything to "once RFC-0009's plugin
API exists" — reasonable at the time, since the plugin loader was the
one piece of genuinely new attack surface (an untrusted `transformIR`
rewriting another component's compiled output). With RFC-0009 now real,
this RFC could finally specify that surface for real. While grounding
guarantee #2 in the actual `runtime/ssr.ts` source (rather than
repeating the original stub's framing without checking it), a live
reproduction proved the request-isolation claim was **false** as shipped
— see Verification for the exact race and fix. A security RFC that
repeats an unverified guarantee is worse than no RFC; this one checks
each claim against real code before writing it down.

## Design

### 1. XSS-safety (verified against existing code, unchanged by this RFC)

`escapeHtml`/`escapeAttr` (`runtime/escape.ts`) are the only two
functions compiled `{expr}`/dynamic-attribute output passes through —
`compiler/codegen.ts`'s `genSSR` emits `$esc(...)` around every dynamic
text node and `$attr(...)` around every dynamic attribute, unconditionally,
for every codegen backend (SSR, hydration, the plugin `codegen()` hook
path). There is no template syntax that produces unescaped output except
`{@html}`.

`{@html}` (`compiler/parse.ts`) is deliberately restricted: rejected
inside islands (`compiler/codegen.ts`'s `genHydrate`/`genCreate` both
throw `"{@html} is not supported inside a hydrated island"`) and inside
each-blocks, per its own doc comment — its only sanctioned use is
server-only layout composition (RFC-0008), embedding a PAGE's own
already-compiler-produced HTML (the `children` prop), never raw user
input. A plugin's `codegen()` hook (RFC-0009) can emit arbitrary HTML
strings, same as any hand-written component's `ssr()` — this is not a
new escape hatch, it's the same trust boundary every component author
already has over their own component's output.

### 2. SSR request-isolation (VIOLATION FOUND AND FIXED)

**The bug, exactly.** `runtime/ssr.ts` originally held per-request state
as `let ctx: RenderContext | null = null;` — a single, module-level,
mutable binding shared by every request the process handles.
`renderToHtml()`/`renderIsland()` are genuinely `async` (a component's
own `ssr()` can `await` arbitrary work — a plugin's `codegen()` hook, a
future data-fetching component), meaning a request's render can suspend
mid-`await` and yield the event loop back to Node, which may then start
handling a second request. If that second request's `beginRender()`
fires before the first's `endRender()`, the module-level `ctx` is
silently reassigned out from under the first request — its subsequent
`renderIsland()`/`registerStyle()` calls write into the SECOND request's
context, and its `endRender()` either returns the wrong (second
request's) data or throws, depending on exact timing.

**Reproduced live**, before any fix: two `beginRender()` calls run via
`Promise.all` with staggered internal delays (simulating real async
component work) reliably corrupted each other's `RenderContext` —
depending on the exact race, either a request's `islands`/`styles`
silently contained a DIFFERENT request's data (a real cross-request data
leak — one user's page could, under load, render with another user's
component instance's styles or island list), or `renderIsland()` threw
`"renderIsland() outside of a server render"` on a perfectly valid,
in-flight request (a real, load-dependent request failure). Neither
failure mode is hypothetical — both were observed directly, deterministically,
with a minimal repro (two concurrent renders, no special timing
manipulation beyond ordinary `setTimeout` delays standing in for real
async component work).

**The fix.** `runtime/ssr.ts` now uses `node:async_hooks`'
`AsyncLocalStorage<RenderContext>`. `beginRender(fn)` establishes a
fresh, isolated context scoped to `fn`'s entire execution — synchronous
AND every `await` inside it — via `AsyncLocalStorage.run()`.
`endRender()`/`registerStyle()`/`renderIsland()` read the CURRENT async
context's store, which `AsyncLocalStorage` guarantees is the correct one
for whichever call chain is actually executing, even when multiple
`beginRender()` calls' internal awaits interleave arbitrarily on the
same event loop tick. This is Node's own, standard mechanism for exactly
this class of problem (the same primitive Express/Fastify request-context
middleware and OpenTelemetry span-context propagation are built on) — not
a bespoke queueing/locking scheme.

**One real complication, found and fixed during implementation, not
assumed away**: `runtime/ssr.ts` is bundled into BOTH the server render
path AND the browser client bundle (`dist/client/runtime.js`, since
client and server share one `runtime/index.ts` entry point) — even
though `beginRender`/`endRender`/`renderIsland` are only ever CALLED
server-side, the module itself must remain importable in a browser
build. A naive top-level `import { AsyncLocalStorage } from
'node:async_hooks'` broke `npm run build` outright (Rollup: `"AsyncLocalStorage"
is not exported by "__vite-browser-external:node:async_hooks"` — a real,
live build failure, not a hypothetical one). Fixed with a
lazily-resolved dynamic `import('node:async_hooks')`, paid once on first
server-side call — Rollup's browser build never evaluates that dynamic
import (since `beginRender()` is never called client-side), so the
client bundle stays genuinely unaffected. `beginRender()`'s signature
changed from synchronous (`beginRender(): void`) to async
(`beginRender<T>(fn: () => T | Promise<T>): Promise<T>`) — every real
call site (`server/dev.ts`, `server/build.ts`, `server/serve.ts`,
plus two test fixtures) was updated to run its render body INSIDE the
callback rather than calling `beginRender()`/`endRender()` as
independent bookend calls; this is a breaking change to `beginRender`'s
Tier 1 signature (RFC-0018) — see that RFC's own `NajmPlugin` addition
precedent for how a real API change gets reconciled with the stability
tiers, applied here to `beginRender` itself.

### 3. Plugin supply-chain trust (RFC-0009's boundary, specified here)

A `NajmPlugin`'s `transformIR(nodes, scope)` can read and rewrite the
FULL IR of the component it's registered against — including injecting
arbitrary `IRStaticHtml`/`raw-html` nodes (the Markdown plugin's own
proof-of-concept does exactly this, deliberately). This is real,
unsandboxed power: a malicious plugin can inject unescaped HTML into any
component whose compile it's wired into via `najm({ plugins: [...] })`.
This is NOT a new vulnerability class this RFC discovers — it is the
same trust level Vite's own plugin system already has (a Vite
`transform()` hook can rewrite any module's source arbitrarily), and
Najm's plugin loader (`compiler/plugin.ts`) is deliberately built AS a
thin extension of that exact mechanism (RFC-0009's own "matching Vite's
own plugin convention rather than inventing a new one"). The security
boundary is therefore identical to Vite's own: **a plugin is exactly as
trusted as any other `devDependency` in your `package.json`** — supply-chain
hygiene (auditing what you install, lockfile integrity) is the actual
mitigation, not a sandbox this RFC does not build. This RFC does NOT add
plugin sandboxing, a permissions model, or a signature/trust-level system
— RFC-0009's own Open Questions explicitly deferred a `trusted: boolean`
field as premature, and this RFC agrees: no concrete incident or threat
model motivates building a sandbox before one exists.

### What this RFC does NOT add

- No plugin sandboxing/permission model (see above — deferred, matching
  RFC-0009's own judgment).
- No CSP/Trusted-Types integration for the compiled output — every
  compiled component's HTML is either escaped by `$esc`/`$attr` or
  explicitly, narrowly opted into raw output via `{@html}`; a consuming
  application's own CSP policy is the application's responsibility, same
  as any other server-rendered HTML.
- No authentication/authorization primitives — RFC-0008's middleware
  (`redirect`/`reject`) is the existing, sufficient hook point for an
  application to implement its own auth; this RFC does not add a
  framework-level auth system.

## Alternatives considered

- **Lock-based request queueing instead of `AsyncLocalStorage`** (serialize
  all renders through a mutex, one at a time). Rejected — this would
  eliminate concurrency entirely (every request waits for the previous
  one's full render, including its async component work), a severe
  throughput regression for zero benefit over `AsyncLocalStorage`'s
  genuine per-request isolation with full concurrency preserved.
- **Per-request `RenderContext` object passed explicitly through every
  function call** (thread a context parameter through `renderToHtml`/
  `renderComponent`/`renderIsland`/`registerStyle`, instead of ambient
  async-local state). Considered — this is arguably MORE explicit/harder
  to get wrong at the type level. Rejected because it would break every
  COMPILED component's generated code: `compiler/codegen.ts`'s generated
  `ssr()` output calls `$style(...)`/`$island(...)` with no context
  parameter (RFC-0018 Tier 1 — the compiler depends on these exact
  signatures across every previously-compiled `.najm` file). Changing
  that call surface is a much larger breaking change than `beginRender`'s
  own signature change, for marginal safety benefit `AsyncLocalStorage`
  already provides.
- **Sandbox plugins in a Worker/vm context.** Rejected for the same
  reason RFC-0009 didn't reserve a `trusted` field: no concrete threat
  model or incident motivates the real complexity (serialization
  boundary between the IR and a sandboxed transform, which nodes/`Scope`
  even CAN cross a structured-clone boundary) that a real sandbox would
  require. Revisit if/when a real multi-tenant or third-party-plugin-
  marketplace use case exists.

## Verification

- **XSS-safety**: `compiler/codegen.ts`'s `genSSR` wraps every dynamic
  text/attribute in `$esc`/`$attr` unconditionally — verified by direct
  inspection (every `em.expr(` call site in `genSSR` confirmed to route
  through the escape helpers). `{@html}` is confirmed rejected inside
  islands/each-blocks by existing, passing tests (`compiler/parse.ts`'s
  own doc comment plus `compiler/codegen.ts`'s `genHydrate`/`genCreate`
  throw paths, exercised by the existing compiler test suites). **Done**
  (pre-existing, re-verified, unchanged).
- **Request isolation — the real finding**:
  - **Reproduced the violation** against the pre-fix code: two concurrent
    `beginRender()` calls with staggered internal delays reliably
    corrupted each other's `RenderContext` (cross-request data or a
    spurious throw, depending on exact timing) — this was a real, live
    reproduction during this RFC's authoring, not a theoretical concern.
  - **Fixed**: `runtime/ssr.ts` rewritten onto `AsyncLocalStorage`,
    lazily imported to keep the client bundle unaffected (a second real
    bug — a browser build failure — found and fixed in the course of
    fixing the first).
  - **New test suite** (`tests/test-request-isolation.ts`, 4 cases):
    two concurrent renders with interleaving awaits never see each
    other's islands; styles registered in one request never leak into a
    concurrent request's context; a ten-way concurrent stress test
    (staggered delays across all ten) where every request sees EXACTLY
    its own two islands, none of another request's; `endRender()`/
    `renderIsland()` called outside `beginRender()` still fail loudly
    (`registerStyle()` stays a silent no-op by design, matching
    RFC-0006's existing "never crash a render over a missing context"
    stance). **All 4 passing.**
  - **`npm test` (full suite, 20 files including the new one) — 100%
    green**, including every existing suite that calls
    `beginRender`/`endRender` directly (`tests/test-partial-hydration.ts`,
    updated to the new async signature) and the full compiler/runtime
    suites (unaffected — this fix touches only `runtime/ssr.ts` and the
    three server entry points' call sites). `npx tsc --noEmit` clean.
  - **Live, real-server proof, not just unit tests**: started
    `server/serve.ts` for real, fired 20 genuinely concurrent HTTP
    requests (shell-backgrounded `curl`, real OS-level concurrency, not
    simulated) at both a zero-island route (`/about`) and an
    islands-bearing route (`/`) — every one of the 20 responses per
    route was byte-identical (`md5sum` comparison), with exactly one
    correct island reference in each islands-bearing response, no
    crashes, no corrupted/duplicated island wrappers. **Done.**
  - **Real production build still succeeds**: `npm run build` (which
    itself drives `beginRender`/`endRender` through the exact same
    `runtime/ssr.ts` code, including the error-boundary demo page)
    exits 0 and produces the same `dist/` shape as before this fix.
    **Done.**
- **Plugin trust boundary**: stated as equivalent to Vite's own plugin
  trust model (design-level claim, not independently testable beyond
  "a plugin's `transformIR` can inject arbitrary HTML," already proven
  by RFC-0009's own Markdown plugin test). **Done** (design-level;
  matches RFC-0009's existing, passing verification).

## Open questions

- Should `AsyncLocalStorage`'s (small, well-documented) per-async-context
  overhead be added to RFC-0014's benchmark suite as a fourth measured
  property (request-handling latency under concurrency), now that a real
  concurrency-sensitive code path exists to measure? Not done in this
  RFC — RFC-0014's three properties were fixed before this fix landed;
  revisit if request-handling latency ever becomes a real, motivated
  concern rather than a speculative addition.
- The plugin trust boundary (§3) is currently a design-level statement,
  not enforced by any runtime check (nothing stops a `transformIR` from
  doing something a "well-behaved" plugin wouldn't). Should
  `compiler/plugin.ts` validate a plugin's IR output shape (e.g., reject
  a `transformIR` return value that isn't a valid `IRNode[]`) as a
  defense-in-depth measure against a BUGGY (not malicious) plugin
  corrupting a compile in a confusing way? Leaning toward: yes, as a
  smaller follow-up (basic shape validation, not a trust/sandbox
  system) — not built in this pass since no concrete bug report
  motivates it yet, consistent with this RFC's own anti-speculation
  stance elsewhere.
