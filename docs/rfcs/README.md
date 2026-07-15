# Najm RFCs

This directory is Najm's architecture record, in the tradition of the Rust
RFC process, React RFCs, Vue RFCs, and the Kubernetes Enhancement Proposal
process. Each RFC is a standalone decision document for one subsystem;
together they are the source of truth for how Najm is built and why.

> **Naming history.** Najm was developed under the working name **Mono**;
> the rename happened at first-public-release preparation (2026-07-14),
> when npm registry checks showed `mono-core`/`create-mono-app` already
> taken and the rebrand decision landed on Najm ("star" in Arabic). Every
> RFC in this directory was updated to the Najm naming; the `legacy/`
> archive (pre-pivot prototypes) retains the Mono-era record verbatim,
> and the architecture review document at the repo root that drove the
> RFC process still refers to Mono — deliberately, as history. See
> RFC-0019 for the package-naming specifics.

## Status legend

- **Draft** — a complete design exists; implementation may be partial or
  not yet started.
- **Accepted** — the design is settled and re-verified against real
  implementation; a stability/process commitment other RFCs can build on.
- **Implemented** — accepted and the corresponding code exists, is
  independently verified (not just self-reported), and passes its RFC's
  stated verification criteria.
- **Stub** — a placeholder naming what the RFC will cover and its exact
  blocker; not yet drafted because that blocker is still genuinely absent.

## Reading paths

- Runtime: RFCs 0002, 0004, 0005, and 0010.
- Compiler and tooling: RFCs 0003, 0009, 0011, 0012, and 0013.
- Rendering and delivery: RFCs 0006, 0007, 0008, and 0017.
- Quality and governance: RFCs 0014, 0015, 0016, 0018, 0019, and 0020.

## Index

| RFC | Title | Status |
| --- | --- | --- |
| [0001](./RFC-0001-vision-and-philosophy.md) | Vision & Philosophy | Implemented |
| [0002](./RFC-0002-runtime-architecture.md) | Runtime Architecture | Implemented |
| [0003](./RFC-0003-compiler-pipeline.md) | Compiler Pipeline | Implemented (all 3 migration steps, including semantic analysis) |
| [0004](./RFC-0004-reactivity-system.md) | Reactivity System | Implemented |
| [0005](./RFC-0005-scheduler-design.md) | Scheduler Design | Implemented |
| [0006](./RFC-0006-ssr-and-rendering.md) | SSR & Rendering | Implemented |
| [0007](./RFC-0007-islands-and-hydration.md) | Islands & Hydration | Implemented (`client:visible`); progressive hydration + `client:idle` deferred |
| [0008](./RFC-0008-routing.md) | Routing | Implemented |
| [0009](./RFC-0009-plugin-api.md) | Plugin API | Implemented |
| [0010](./RFC-0010-devtools-protocol.md) | DevTools Protocol | Implemented |
| [0011](./RFC-0011-cli-specification.md) | CLI Specification | Implemented (5 of 6 subcommands proven end-to-end via real subprocess; `najm test` explicitly out of scope) |
| [0012](./RFC-0012-language-server.md) | Language Server (LSP) | Implemented |
| [0013](./RFC-0013-vscode-extension.md) | VS Code Extension | Draft (client wiring built and structurally verified; real VS Code activation unverified — see its own honesty note) |
| [0014](./RFC-0014-performance-benchmarks.md) | Performance Benchmarks | Implemented |
| [0015](./RFC-0015-testing-strategy.md) | Testing Strategy | Implemented |
| [0016](./RFC-0016-security-model.md) | Security Model | Implemented (found and fixed a real cross-request data race in shipped SSR code — see its own Verification) |
| [0017](./RFC-0017-browser-compatibility.md) | Browser Compatibility | Accepted |
| [0018](./RFC-0018-public-api-stability.md) | Public API Stability | Accepted (with a post-acceptance revision note — RFC-0016's fix changed a Tier 1 signature) |
| [0019](./RFC-0019-release-strategy.md) | Release Strategy | Implemented (four npm workspace packages, fixed Changesets beta line, verified tarballs; CLI explicitly deferred) |
| [0020](./RFC-0020-long-term-roadmap.md) | Long-term Roadmap | Draft (real backlog inventory + one data-motivated investigation from RFC-0014's actual benchmark numbers) |

All 20 RFCs now have real content — no bare stubs remain. Every
`Implemented`/`Accepted` status above was independently re-verified
(not taken on a single report) before being recorded here: real test
suite runs, real `npx tsc --noEmit`, and for anything touching a server
or browser, real live checks (a running dev/production server hit with
actual HTTP requests, a real headless-browser session, or a real spawned
subprocess) — the pattern established from RFC-0001 onward and held
constant through RFC-0020.

## Why RFCs 0001–0008 first

These eight cover the subsystems every other subsystem depends on: what
Najm is (0001), how components/signals/context live at runtime (0002), how
`.najm` files become code (0003), how reactivity actually works (0004), how
effects get scheduled (0005), how HTML gets produced (0006), how hydration
is scoped (0007), how URLs map to code (0008). Plugins, DevTools, the CLI,
the LSP, and the VS Code extension are all consumers of these — writing
them first would mean documenting an API surface that doesn't exist yet.

## How 0009–0020 unblocked, in the order it actually happened

**RFC-0003's deferred "step 3" (semantic analysis)** landed first —
`compiler/semantics.ts` replaced `ir.ts`'s coarse free-identifier regex
with real resolution against a component's declared scope. That unblocked
**RFC-0009 (Plugin API)** and **RFC-0012 (Language Server)** simultaneously,
since both need `deps`/`Scope` to be trustworthy, not approximate.

**RFC-0012's server**, once real (a stdio LSP server, live-verified with
an actual JSON-RPC round trip — a real `initialize` handshake and a real
`publishDiagnostics` notification with a correct character range),
unblocked **RFC-0013 (VS Code Extension)**'s client-wiring half.

**RFC-0009's plugin loader**, once real (a two-line-per-compile-path seam
in `compiler/codegen.ts`, a working Markdown proof-of-concept plugin,
byte-identical output proven when no plugin is registered), unblocked
**RFC-0016 (Security Model)** — whose own authoring, while verifying the
"no per-request state leaking" claim against real code rather than
repeating it unverified, found that claim **false**: a real,
live-reproduced cross-request race condition in `runtime/ssr.ts`'s
`RenderContext`, live in shipped "Implemented" code. Fixed with
`AsyncLocalStorage`, verified with a new 4-case test suite plus 20 real
concurrent HTTP requests against a running production server (byte-identical
responses, zero corruption). This is the one finding in this RFC series
that changed shipped runtime behavior, not just documentation.

**The production build pipeline** (`server/build.ts`/`server/serve.ts`,
live-verified against every route class — static, dynamic-segment,
middleware-guarded — with real browser hydration through a
production-built, hashed client chunk) unblocked **RFC-0011 (CLI)**,
**RFC-0014 (Benchmarks)**, and **RFC-0017 (Browser Compatibility)**
together. RFC-0011's `najm` binary (`cli/najm.ts`) was then built for
real — `doctor`/`lint`/`build`/`dev`/`preview`/`create-najm-app`, five of
six proven via real subprocess invocation. RFC-0014's three measured
properties (zero-JS bundle size, hydration-cost-scales-with-bindings,
signal latency) were automated for real — `benchmarks/`, a committed
`baseline.json`, and a proven-non-vacuous regression gate (a deliberate
break was introduced, caught, and reverted during verification).

**RFC-0018 (Public API Stability)** and **RFC-0017** were both moved
Draft → Accepted after re-verifying their claims against the codebase
state five RFCs later than when they were first drafted — one real gap
was found (`NajmPlugin` had no tier assignment) and closed before
accepting. RFC-0018 later gained a post-acceptance revision note when
RFC-0016's fix changed `beginRender`'s Tier 1 signature — recorded as a
revision, per this project's own "no silent edits to accepted decisions"
rule, not silently patched.

**RFC-0019 (Release Strategy)**, once RFC-0018 was Accepted, found a
real, unresolved discrepancy between the `packages/najm-server` npm
blueprint (which expects a compiled `dist/cli.js`) and the actual,
working CLI (`cli/najm.ts`, with no relationship to `packages/` at all) —
documented precisely rather than silently reconciled, since the real fix
requires a scoped decision (a fifth `najm-language-server` package, or
inlining) this RFC didn't make unilaterally.

**RFC-0020 (Long-term Roadmap)**, once RFC-0014's real automated data
existed, used that data rather than guessing: the one number that
surprised its own author — a hydration-cost tolerance widened from a
planned 1.5x to a measured 3x, because real browser layout/paint cost
(not Najm's runtime) dominates at scale — became this RFC's one
data-motivated investigation candidate, distinct from the
already-known backlog (Tier A) and the still-correctly-deferred v2
research items (Tier C: resumability, a Rust rewrite, distributed
compilation — none motivated by any real measured bottleneck yet).

## Amending an RFC

Architecture changes get a new RFC revision, not silent edits to accepted
decisions — add a "Revision history" (or, as RFC-0018 did, an inline
"Revision note") section and cross-link. If a later RFC supersedes an
earlier decision, say so explicitly in both documents.
