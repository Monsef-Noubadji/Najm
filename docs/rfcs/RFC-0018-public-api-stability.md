# RFC-0018: Public API Stability

- **Status:** Accepted
- **Depends on:** RFC-0002–0010 (all Implemented — the surface being classified)

**Acceptance note.** Moved from Draft to Accepted after re-verification
against the state of the codebase following RFC-0009/0011/0013/0014's
implementation work: Tier 1's "compiler depends on this by name" claim
re-checked against the current `compiler/codegen.ts` `HELPER_IMPORT` list
(unchanged), Tier 3's leak-freedom re-checked against `runtime/index.ts`
(still zero leaks, and the plugin loader's internal `runPlugins()` seam
confirmed to stay unexported alongside it). One real gap was found and
closed before acceptance: `NajmPlugin` (RFC-0009, built after this RFC
was originally drafted) had no tier assignment — added to Tier 2 below.
No other gaps found; the tier boundaries have now held across five
RFCs' worth of subsequent real implementation without needing to move
anything between tiers, which is the concrete signal that the
classification is settled rather than a guess.

**Revision note (post-acceptance).** RFC-0016's authoring found
`beginRender()` — Tier 1 — genuinely violating the request-isolation
guarantee it exists to provide (a real, live-reproduced cross-request
data race; see RFC-0016's Verification). Fixing it required a real
breaking signature change: `beginRender(): void` →
`beginRender<T>(fn: () => T | Promise<T>): Promise<T>`. Per this RFC's
own Tier 1 rule ("breaking changes require a major version bump") and
its own "Architecture changes get a new RFC revision, not silent edits"
process (see the RFC index's Amending-an-RFC section), this is recorded
here rather than silently patched: `beginRender` keeps its Tier 1
classification (the compiler's generated code doesn't call it directly —
only the three server entry points do — so the "compiler depends on
this by name" criterion doesn't strictly apply, but its role as the
foundational per-request isolation primitive every render path depends
on makes Tier 1 the correct classification regardless). The version bump
this signature change requires has not yet been cut (no npm package has
published yet — RFC-0019, still blocked on this RFC's acceptance,
un-blocks now that this note exists) — when it is, this change is the
first real Tier 1 breaking change this project's version history will
record, and its own migration note is exactly RFC-0016's Verification
section: every call site becomes `await beginRender(async () => { ...
the old body between beginRender()/endRender() ... })`.

## Summary

Classifies `runtime/index.ts`'s current export surface (accumulated
across RFC-0002, 0004, 0005, 0006, 0007, 0010) into three stability
tiers — **Stable**, **Settling**, **Internal-only** — and states the
semver/deprecation rules for each. This RFC does not wait for npm
publication (`packages/`) to exist: the classification work is about
which ALREADY-IMPLEMENTED exports have proven, through real use across
six RFCs' worth of implementation and live verification, to be load-
bearing primitives versus still-adjustable details — that judgment is
possible now, from the actual export list, independent of distribution
mechanics.

## Motivation

`runtime/index.ts` currently exports roughly 40 names with no stated
promise about which ones a consumer can build against without risk of a
breaking change next RFC. Some of these (`signal`, `effect`,
`FunctionalComponent`) are exactly the primitives RFC-0001 named as
Najm's core identity — changing their shape would break every `.najm`
file's compiled output. Others (`GraphSnapshot`'s exact field names,
RFC-0010's newest export) were designed and shipped in the immediately
preceding session and haven't been tested against a second consumer's
real usage yet. Treating both classes identically — either "everything
is stable" (locks in details that may need to change) or "nothing is
stable" (promises nothing, defeats the purpose of publishing a package)
— is wrong. This RFC draws the line with the actual export list in hand,
not a guess.

## Design

### Tier 1 — Stable: breaking changes require a major version bump

The primitives every compiled `.najm` file's generated code (RFC-0003)
depends on directly, plus the component contract RFC-0002 fixes:

```text
signal, computed, effect, batch, untrack, onCleanup, isSignal, get
  — RFC-0004's reactivity core. A signature change here breaks every
    compiled component's generated closures, not just hand-written code.

FunctionalComponent, ComponentView, mountComponent, instantiate
  — RFC-0002's component ABI. The compiler's codegen (compiler/codegen.ts)
    emits code assuming this exact shape ({ ssr, hydrate }).

onMounted, onUpdated, onDestroyed
  — RFC-0002's lifecycle hooks — public, documented, user-facing API
    surface (not just compiler-internal).

claim, eachBlock, hoistTemplate, bindText, bindAttr, bindValue,
bindChecked, listen, setAttr
  — RFC-0003/0007's hydration/binding primitives. compiler/codegen.ts's
    generated output calls these by name ($text, $claim, etc. are
    aliased imports of exactly these) — renaming or reshaping any of
    these breaks EVERY existing compiled .najm file, not just new ones.

beginRender, endRender, renderToHtml, renderComponent, renderIsland
  — RFC-0006's SSR pipeline, called directly by generated ssr() output.

createContext, provide, inject
  — RFC-0002's DI system. Public, documented, the Angular-inspired
    surface RFC-0002 explicitly kept.

defineStore
  — RFC-0002's store. The `$actions`/`$getters`/`$replaceState`/
    `$subscribe` shape on a returned store instance is part of this
    contract too, not just the factory function's own signature.
```

Everything in this tier shares one property: changing it breaks
generated code from a PAST compiler version, not just hand-written user
code. That's the bar for Stable — not "this seems important" but "the
compiler already emits code assuming this exact shape, so a break here
is retroactive."

### Tier 2 — Settling: may change with a minor version + migration note

```text
withErrorBoundary, OnError, ErrorPhase          (RFC-0006)
enableTimeTravel, HistoryEntry, TimeTravelController  (RFC-0002)
enableGraphInspector, snapshot, GraphSnapshot   (RFC-0010)
enableFlushTiming, FlushEvent                   (RFC-0010)
hydrateIslands, IslandRef, RenderContext        (RFC-0006/0007)
createRoot, withEffectObserver, currentOwner, OwnerHandle  (RFC-0002)
NajmPlugin (compiler/plugin-api.ts's transformIR/codegen shape)  (RFC-0009)
```

Real, working, tested — but each has had exactly one implementation and
zero real second-consumer usage informing its exact shape. RFC-0010's
two newest exports (`GraphSnapshot`, `FlushEvent`) are the clearest
case: their field names were fixed during a single implementation pass
last session, verified against one test suite and one live browser
check — enough to prove the MECHANISM works, not enough to prove the
exact shape is what a real DevTools panel consumer (RFC-0013, not yet
built) will actually want. A minor-version change to a Settling export
requires a one-line migration note in the changelog; it does not require
a major version bump. `NajmPlugin` belongs here for the identical
reason: RFC-0009's Markdown plugin proves the `transformIR(nodes, scope)`
contract is expressive enough for a real use case, but no third-party
plugin author has built against it yet — the `codegen()` hook's output
channel (`onPluginCodegen` callback, RFC-0009's own documented judgment
call) is the piece most likely to need revision once a second real
codegen-hook consumer exists.

### Tier 3 — Internal-only: never was public API, exported for wiring only

```text
__setFactories, __addDrainHook, _devtoolsInspect, _devtoolsSubs
```

RFC-0010's own implementation added these specifically to let
`devtools-graph.ts`/`devtools-timing.ts` decorate `signals.ts`/
`scheduler.ts` from outside their defining module (documented in
`signals.ts`'s own comments as the "ES module bindings are read-only"
workaround). These are exported from their SOURCE module but
deliberately NOT re-exported from `runtime/index.ts`'s public surface —
confirmed by inspection: `runtime/index.ts` re-exports `enableGraphInspector`/
`enableFlushTiming` (Tier 2) but never `__setFactories`/`__addDrainHook`
themselves. This tier's rule: an `_`/`__`-prefixed or underscore-method
export existing in a source file is not a stability promise about
anything; it's plumbing, and this RFC's only job regarding this tier is
confirming none of them leak into `runtime/index.ts`'s actual public
surface (see Verification).

### Deprecation process (applies to Tier 1 and 2)

1. Mark deprecated in the export's doc comment (`@deprecated` JSDoc tag)
   with the replacement, in the SAME release that introduces the
   replacement — never remove-then-replace, always overlap.
2. Deprecated exports remain functional for at least one minor version
   (Tier 2) or one major version (Tier 1) after the replacement ships.
3. Removal is itself a version bump matching the tier (Tier 1 removal =
   major; Tier 2 removal = minor is acceptable, with the changelog
   migration note from when it was marked Settling still applying).

## Alternatives considered

- **Everything is Stable from v1.0 (a single-tier policy).** Rejected —
  would either freeze `GraphSnapshot`'s field names before any real
  second consumer has used them (RFC-0010 shipped one implementation
  pass ago), or would be dishonest about the actual confidence level
  behind a one-session-old export.
- **Everything is unstable/no promises until a 1.0.0 release.** Rejected
  — this is the status quo the stub described as "promising nothing
  meaningful." The compiler's generated-code dependency on Tier 1's
  exports (RFC-0003's codegen calling `$claim`/`$text`/etc. by name) is
  a REAL stability requirement today, independent of what version number
  is on `package.json` — a 0.x version number doesn't make a compiler
  emitting code against a specific runtime shape any less real.

## Verification

- Tier 1's "compiler depends on this by name" claim is directly
  checkable: `compiler/codegen.ts`'s `HELPER_IMPORT` constant lists
  exactly the aliased imports (`$get`, `$text`, `$claim`, `$each`,
  `$hoist`, `$battr`, `$bval`, `$bchk`, `$on`, `$style`, `$comp`,
  `$island`, `$attr`, `$esc`) generated code relies on — cross-referenced
  against Tier 1's list above, every one is present. **Done** (verified
  by direct inspection during this RFC's authoring).
- Tier 3 leak check: `runtime/index.ts` grepped for `__setFactories`,
  `__addDrainHook`, `_devtoolsInspect`, `_devtoolsSubs` — none appear in
  its export statements (only in the source files that define them,
  imported and used internally by `devtools-graph.ts`/`devtools-timing.ts`,
  never re-exported). **Done** (verified by direct inspection).
- **Action item, not yet implemented**: an automated gate (candidate:
  extend `tests/test-runtime-boundary.ts` again, or a new
  `tests/test-api-stability.ts`) asserting `runtime/index.ts`'s actual
  export list is a subset of {Tier 1 ∪ Tier 2} — i.e., nothing new gets
  added to the public surface without a conscious decision about which
  tier it belongs in, the same enforcement pattern RFC-0015's
  suite-registration gate and RFC-0002's boundary gate already
  established for their respective concerns.

## Open questions

- Does `compiler/codegen.ts`'s `HELPER_IMPORT` list itself need its own
  explicit stability tier, separate from `runtime/index.ts`'s
  human-facing export list? It's arguably MORE stable than Tier 1 (a
  break here doesn't just affect hand-written code depending on the
  package, it invalidates every previously-compiled `.najm` output
  file), but it's also not really "public API" in the sense a package
  consumer imports directly — it's the compiler's own internal contract
  with the runtime. Leaning toward: treat it as Tier 1 but note the
  distinction explicitly if this RFC is revised.
