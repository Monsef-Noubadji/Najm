# RFC-0020: Long-term Roadmap

- **Status:** Draft
- **Depends on:** RFC-0014 (Performance Benchmarks, Implemented — real,
  automated data now exists to prioritize against)

## Summary

RFC-0001–0019 are Implemented, Accepted, or Draft-with-real-code except
for a small, precisely-bounded set of genuine follow-ups (RFC-0012/0013,
RFC-0016, RFC-0019). This RFC does two things, both grounded in real
data rather than guesses: (1) inventories every ALREADY-KNOWN deferred
item across RFC-0001–0019's own Open Questions/action items — this
project's actual backlog, not invented here — and (2) uses RFC-0014's
real, automated `benchmarks/baseline.json` to say which of the
architecturally-larger "v2 research" items (resumability, a Rust/SWC
compiler rewrite, distributed compilation) are actually motivated by
measured numbers versus still purely speculative.

## Motivation

Every prior stub of this RFC deferred writing a v2+ agenda until real
benchmark data existed, specifically to avoid guessing which deferred
piece "actually matters" (the stub's own words). That data exists now.
Reading it honestly changes the answer from what a generic framework
roadmap would guess: **the hydration-cost tolerance had to be widened
from a planned 1.5x to an observed 3x** (RFC-0014's own documented
finding) because real DOM layout/paint scheduling cost — NOT anything
Najm's own runtime does — dominates at scale. That is a concrete signal
about where investigation should go next, and it is not "rewrite the
compiler in Rust" (RFC-0001's explicitly-deferred item) — Rust would not
touch layout/paint cost at all.

## Design

### Tier A — Small, scoped follow-ups already named by name (do these first)

Pulled directly from RFC-0006–0019's own Open Questions/action items,
each already precisely scoped by the RFC that named it — no new
investigation needed, just capacity:

```text
RFC-0012/0013  najm-language-server packaging (RFC-0019's own
               unresolved discrepancy: publish a 5th package vs. inline
               into najm-compiler) — blocks a real VS Code extension
               install, not just the in-repo dev-mode one already built
RFC-0013       bundle language-server/server.ts into the packaged
               .vsix (currently spawned via `npx tsx`, which assumes
               tooling a real end user's machine may not have)
RFC-0016       validate a plugin's transformIR() return shape
               (defense-in-depth against a BUGGY, not malicious, plugin)
RFC-0019       pnpm-workspace.yaml (or npm workspaces) wiring so
               release.yml's `pnpm -r test/typecheck/build` actually
               runs against this repo's real scripts
RFC-0007       client:idle directive (deferred since RFC-0007 first
               shipped client:visible; RFC-0005's scheduler idle
               priority already exists and is unconsumed — this is the
               one concrete consumer that would finally use it)
RFC-0008       middleware data-passing (inject an authenticated-user
               object the page reads, beyond today's redirect/reject-only
               control flow) — no concrete use case yet per RFC-0008's
               own text, include here only if one surfaces
```

### Tier B — Data-motivated investigation (RFC-0014's baseline says: look here)

The ONE finding from real benchmark data worth elevating to its own
investigation, because the number that surprised the person who measured
it (a widened tolerance, not a tightened one) is a genuine signal, not
noise:

```text
Hydration cost at scale (RFC-0014's 3x-not-1.5x finding)

  What's known: benchmarks/hydration-cost.ts's own INIT_SCRIPT comment
  documents that navigation-start-based timing was rejected because raw
  HTML PARSE time (not hydration) measurably scales with N — i.e., a
  large static DOM costs real, observable time even before any Najm
  runtime code runs, purely from the browser parsing more HTML.

  What this motivates: NOT a runtime/compiler change (RFC-0003's
  static-hoisting claim — hydration cost scales with dynamic bindings,
  not template size — remains TRUE and unviolated; this is a SEPARATE
  axis, raw parse cost, that hoisting was never designed to address).
  Candidate v2 investigation: does streaming SSR (chunked HTML delivery,
  letting the browser start parsing/painting before the full response
  arrives) reduce the OBSERVED wall-clock number, even though it
  wouldn't change what RFC-0003 already correctly claims? This is
  genuinely open — no implementation exists to evaluate, and it's the
  first roadmap item this RFC's writing actually discovered from data
  rather than inherited from a prior RFC's Open Questions.
```

### Tier C — Previously-scoped v2 research (RFC-0001/0007's original deferrals, re-confirmed still correctly deferred)

```text
Resumability (RFC-0007's own positioning: SSR → Islands → Partial
  Hydration → Progressive Hydration → Resumability). Prerequisite
  (progressive hydration, using RFC-0005's scheduler priorities to
  prioritize above-the-fold islands) has NOT been built — RFC-0007's
  "next increment, direction only" section for progressive hydration is
  still just direction, no code. Resumability itself stays correctly
  un-started until that prerequisite lands; the Beta-era prototype
  remains preserved at legacy/ as prior art, per RFC-0001's original
  archival decision.

Rust/SWC compiler rewrite (RFC-0001's original deferral). RFC-0014's
  real data gives no signal motivating this: nothing in
  benchmarks/baseline.json measures COMPILE time (all three measured
  properties are about the OUTPUT — bundle size, hydration cost, signal
  latency — never how long `compile()` itself takes to run). Compile-time
  benchmarking doesn't exist yet; until it does and shows compile time
  as a real bottleneck, RFC-0001's original reasoning holds exactly as
  written — Rust changes performance, not architecture, and there is no
  performance problem identified to change.

Distributed/incremental compilation (building on RFC-0003's IR).
  Same status as the Rust rewrite — no compile-time benchmark exists to
  motivate it. Genuinely blocked on the same missing measurement, not
  independently investigated.

Cross-framework interop beyond the Web Component boundary (RFC-0002's
  boundary decision). No second real use case has surfaced since RFC-0002
  drew this line; still correctly out of scope.
```

### What this RFC does NOT do

- Does not commit to a v2.0 date or feature list — Tier A is real,
  scoped work; Tiers B and C are investigation candidates, not
  commitments. RFC-0001's "prevent v1 scope creep" purpose for this
  document still holds.
- Does not add compile-time benchmarking itself — identified above as a
  real gap (nothing in RFC-0014 measures it), but building it is its own
  scoped task, not done inside this roadmap RFC.
- Does not resolve any of Tier A's items — they're inventoried here with
  their real source RFC cited, not solved here; solving them belongs to
  whichever future work picks them up.

## Alternatives considered

- **A generic "framework maturity" roadmap** (add SSG, add streaming,
  add server components, ...) picked from what other frameworks have.
  Rejected — exactly the "features because a competitor has them"
  pattern RFC-0001 rejects from the start. Every item in Tiers A–C above
  traces to either a real, already-shipped RFC's own named follow-up, or
  real measured data from this project's own benchmark suite. Nothing
  here was invented by looking at what React/Vue/Astro/Qwik have that
  Najm doesn't.
- **Prioritizing Tier C (resumability, Rust) over Tier A/B because
  they're architecturally more interesting.** Rejected — Tier A items
  are small, already-scoped, and several are real correctness/packaging
  gaps (the LSP packaging discrepancy, the plugin-shape validation) that
  block real usage today; Tier C items have no data motivating them yet.
  Working on the more "interesting" problem before the boring, scoped,
  already-blocking one would be exactly the kind of priority inversion
  RFC-0001's philosophy argues against.

## Verification

- **Tier A's inventory is accurate**: every item traces to a direct
  quote/citation from its source RFC's own Open Questions or action-item
  section, cross-checked by direct file inspection while writing this
  RFC (not reconstructed from memory) — confirmed against RFC-0007,
  0008, 0012, 0013, 0016, 0019's actual current text.
- **Tier B's finding is real, not invented**: `benchmarks/baseline.json`'s
  `hydrationCost.ratio: 2.252` and `benchmarks/hydration-cost.ts`'s own
  `TOLERANCE_RATIO` comment (documenting the 1.5x → 3x widening and why)
  were both read directly from the real, committed files, not
  paraphrased from an earlier summary.
- **Tier C's "no compile-time benchmark exists" claim**: verified by
  inspecting `benchmarks/baseline.json`'s actual schema (`bundleSize`,
  `hydrationCost`, `signalLatency` — three keys, none measuring
  `compile()`'s own execution time) and `benchmarks/run.ts`'s three
  measured properties, matching RFC-0014's own Design section exactly.

## Open questions

- Should Tier B's streaming-SSR investigation get its own stub RFC now
  (RFC-0021, extending the numbering) or stay as a roadmap line item
  until someone picks it up? Leaning toward: stays a roadmap line item —
  RFC-0001's numbered-stub pattern was for the ORIGINAL 20-item review
  breakdown; a new architecture area discovered from data, not from the
  original review, doesn't need to inherit that same ceremony until
  real design work actually starts on it.
- This RFC's own Tier A/B/C framing — worth keeping as the permanent
  shape of future roadmap revisions, or was it specific to this
  particular snapshot of the project's state? Revisit whenever this RFC
  is next revised; no need to decide now.
