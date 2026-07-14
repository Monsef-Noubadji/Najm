# RFC-0007: Islands & Hydration

- **Status:** Claim-walk + `client:load` islands: **Implemented.** Partial
  hydration (`client:visible`): **Implemented.** Progressive hydration and
  resumability: **Draft / deferred** (direction only — see below).
- **Depends on:** RFC-0002, RFC-0003, RFC-0006
- **Formalizes:** `runtime/hydrate.ts`, `runtime/client.ts`
  (implemented, browser-verified); **positions:** Najm's place on the
  review's hydration roadmap

## Summary

Najm hydrates via a **claim walk**, not re-rendering: because the SSR
string and the client hydration function are generated from the same IR
(RFC-0003), the client already knows the exact shape of the server's HTML
and adopts it node-by-node, attaching effects and listeners only where the
template is dynamic. `client:load` marks a component as an island — a
subtree that ships and hydrates its own JavaScript, while the rest of the
page ships none. This RFC formalizes that mechanism and states explicitly
where Najm sits on the review's roadmap:

```text
SSR → Islands → Partial Hydration → Progressive Hydration → Resumability (v2+)
      ▲ Najm is here (v0.x)
```

Partial hydration (hydrating only the parts of an island that are
currently interactive-relevant, e.g. skipping a collapsed accordion's
contents) is the next real increment on this path. Resumability is
explicitly out of scope until the earlier stages are solid — see
`legacy/README.md` and RFC-0001.

## Motivation

The claim-walk mechanism and islands model already work and were
browser-verified (Beta session: SSR output inspected over HTTP, hydration
exercised in Chromium with node-identity checks proving surgical updates).
What this RFC adds beyond documentation is the explicit roadmap
positioning the architecture review asked for — without it, "islands" and
"resumability" read as two options on equal footing, when the review is
clear they are sequential stages with different maturity requirements.

## Design

### The claim walk (implemented, formalized here)

The server leaves two kinds of breadcrumb comments where content length
varies, so the client's walk stays deterministic without needing IDs or
data attributes on every node:

```text
<!--#-->text<!--/-->     a dynamic text expression's boundaries
<!--[--> ... <!--]-->    a variable-length region ({#each} output)
```

`claim(root)` returns a depth-first cursor (`element()`, `text()`,
`dynText()`, `block()`, `staticSubtree()`, `enter()`/`exit()`) that the
compiler's hydration codegen backend (RFC-0003) drives in template order.
A hoisted static subtree (RFC-0003's optimization pass) claims its root in
ONE call via `staticSubtree()` and is never descended into — hydration
cost is proportional to the number of dynamic bindings in a template, not
its total node count. This was directly measured: a template with a
static `<header>` containing two elements and two text nodes compiles to
one `staticSubtree()` claim, not four individual node-walk calls
(`tests/test-hoisting.ts`'s "mixed template" case).

### Islands (implemented, formalized here)

```html
<TodoList client:load initial={[...]} />
```

compiles (RFC-0003) to a `renderIsland()` call that wraps the component's
SSR output in `<najm-island data-src="..." data-props="...">` and records
an `IslandRef` in the request's `RenderContext`. The server shell
(RFC-0006) emits exactly one `<script type="module">` per response,
listing only the distinct component sources actually used on that page —
and emits nothing at all if `islands` is empty. `hydrateIslands()`
(`client.ts`) walks the `<najm-island>` elements, dynamically imports each
one's module, and calls `mountComponent()` (RFC-0002) against the existing
DOM.

Island props must be JSON-serializable — this is not an arbitrary
restriction but the direct consequence of props crossing the server→client
boundary as a `data-props` attribute string; it is the same constraint
every islands framework (Astro, Fresh) has for the same reason.

### Partial hydration (implemented: `client:visible`)

`client:load` still hydrates an island's entire subtree eagerly, as soon
as the bootstrap script runs — that mechanism and its output are
byte-for-byte unchanged by this section. `client:visible` is a second
directive that defers the *same* hydration mechanism (a claim walk) until
the island's element scrolls into the viewport, rather than running it
unconditionally at page load. This is deliberately not a different
hydration mechanism: it composes with the existing claim-walk cursor by
starting the walk later, driven by a compiler-emitted trigger, exactly as
this RFC originally sketched.

**Directive syntax.** `parse.ts` recognizes `client:load` and
`client:visible` as the two `client:` directives a component tag may
carry (`IslandStrategy = 'load' | 'visible'`); any other `client:xxx`
(including `client:idle`, still unimplemented — see Open questions) fails
to compile with a clear error naming the unsupported directive. The
strategy is threaded from the parsed `TComponent` node through
`IRInclude.islandStrategy` (`compiler/ir.ts`) unchanged, so codegen never
re-derives it from raw attributes.

**Codegen shape.** `renderIsland()`'s call site (`$island(...)`, aliased
from `renderComponent`/`renderIsland` in `compiler/codegen.ts`) takes an
optional 4th argument: absent for `client:load` (and for the default when
no strategy is given), `"visible"` for `client:visible`. This keeps
`client:load` islands' generated code — and therefore their SSR output —
byte-for-byte identical to before this directive existed; only
`client:visible` adds anything new to the call. At the HTML level,
`renderIsland()` (`runtime/ssr.ts`) wraps SSR output in
`<najm-island style="display:contents" data-src="..." data-props="...">`
exactly as before, with one addition: a `client:visible` island's wrapper
also carries `data-hydrate="visible"`. Absence of `data-hydrate` (or any
value other than `"visible"`) means eager — the safe, non-breaking
default a page's existing islands keep getting.

**Runtime mechanism.** `hydrateIslands()` (`runtime/client.ts`) partitions
the page's `<najm-island>` elements into an eager batch (no
`data-hydrate="visible"`) and a lazy batch, on first pass, exactly as it
always walked them. The eager batch hydrates immediately and in parallel,
unchanged. The lazy batch is handed to `observeLazyIslands()`, which
attaches one `IntersectionObserver` per lazy island (`rootMargin: '200px'`
— a head start so the dynamic import and hydration work finish slightly
before the element is actually on screen at typical scroll speeds) and
disconnects it after its one-shot trigger fires — an island hydrates at
most once. The observer watches the island's first rendered element
child, not the `<najm-island>` wrapper itself: the wrapper renders
`display:contents` so it never has a box of its own, and
`getBoundingClientRect()` on a `display:contents` element is always
`{0,0,0,0}` — observing it directly would never report an intersection in
a real browser (caught live during browser verification of the demo
page). If `IntersectionObserver` is unavailable, lazy islands fail open
and hydrate immediately rather than never hydrating. Both paths converge
on the same `hydrateOne()` helper and the same "hydrated" signal
(`data-hydrated` set on the element after `mountComponent()`/`hydrate()`
succeeds) — the only difference between `client:load` and `client:visible`
is *when* `hydrateOne()` runs, never *how*.

**Example.** `src/pages/partial-hydration-demo.najm` places a
`<TodoList client:visible .../>` island several screens below the fold
(six spacer sections) so the timing difference is observable: on load the
island's SSR'd markup is present but unhydrated and its component chunk
is never fetched; scrolling it into view (within the 200px margin)
triggers the import and hydration, after which its checkbox/input
interactions work.

### Progressive hydration (later increment, direction only)

Where partial hydration is about *which regions* hydrate, progressive
hydration is about *hydration priority* under load — using RFC-0005's
scheduler priorities (`sync`/`microtask`/`idle`) to hydrate
above-the-fold or user-interacted islands before below-the-fold ones,
rather than all islands hydrating in the DOM-order they're listed in
today. This depends on RFC-0005 existing first.

### Resumability: explicitly deferred

The resumability prototype built during Beta (QRL-based lazy handler
resolution, serialized signal graphs, a delegating bootloader) is real,
was browser-verified, and is preserved at `legacy/framework/runtime/`. It
is not part of Najm's v1 architecture. Per RFC-0001 and the review: real
resumability requires serializing execution state, lexical scopes,
closures, and dependency graphs coherently across the SSR/hydration
boundary — a distinct compiler and runtime architecture, not a hydration
mode layered onto the claim-walk model this RFC specifies. It is
positioned as v2+ research, to be revisited once partial and progressive
hydration are shipped and Najm's actual bottlenecks (not a competitor's
feature list) motivate it.

## Alternatives considered

- **VDOM-based hydration (render client-side, diff against server DOM).**
  Rejected from the start of the project — the entire premise of
  compiler-first + signals is that the compiler already knows what's
  dynamic, so there is nothing to diff. Restated here because RFC-0006/7
  are where "no VDOM" becomes a concrete, verifiable claim (zero diffing
  code exists in `hydrate.ts`).
- **Ship resumability as an opt-in v1 feature (Beta's actual approach).**
  Rejected per RFC-0001 and the archival decision — real state
  persistence across the resumability boundary needs a coherent
  serialization design, and shipping a labeled-prototype version
  alongside the claim-walk model risks users depending on an
  architecture that the real, complete version (v2+) may need to change
  underneath them.

## Verification

Already verified (Beta session, preserved as the bar this RFC's
implementation must continue to meet):

- SSR output inspected over HTTP: correct comment markers, correct
  `data-src`/`data-props` island wrapper, zero `<script>` tags on a
  zero-island page.
- Browser: island hydrates without mismatch; a node-identity check
  (`sameLiNode === true` after a checkbox toggle) proves a signal write
  updates the DOM surgically without rebuilding a claimed list region.
- `tests/test-hoisting.ts`: static-subtree claim collapse verified at
  the generated-code level (exact claim-call sequence asserted, not just
  "it compiles").

## Open questions

- `client:idle` directive syntax (defer hydration until the main thread is
  idle, via `requestIdleCallback` or RFC-0005's scheduler idle priority)
  is still unimplemented — `client:visible` is the only partial-hydration
  trigger shipped by this revision. `parse.ts` explicitly rejects
  `client:idle` today rather than silently accepting and ignoring it.
