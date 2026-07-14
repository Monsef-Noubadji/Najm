# RFC-0019: Release Strategy

- **Status:** Draft
- **Depends on:** RFC-0018 (Public API Stability, Accepted)

## Summary

Four packages, one version line: `najm`, `najm-compiler`,
`najm-router`, `najm-server` — all four exist today as real, versioned
`package.json` manifests under `packages/`, all pinned to `0.3.0-dev`.
Versioning follows RFC-0018's tiers directly: a Tier 1 breaking change
requires a major bump across all four packages simultaneously (they
release together, never independently — `najm-server` depends on
`najm-router` depends on `najm-compiler` depends on `najm`, per
`packages/README.md`'s dependency graph, so a version skew between them
is never a supported configuration). A Tier 2 change is a minor bump. A
`.github/workflows/release.yml` already exists, using Changesets +
pnpm + npm provenance — this RFC adopts and reconciles it against what
was actually built, rather than replacing it.

**This RFC found a real, unreconciled gap between the packaging
blueprint and the actual, working code**, documented below rather than
silently assumed fixed — see "The `najm-server`/`cli/` discrepancy."

## Motivation

RFC-0018 existing (Accepted) is what makes a release strategy meaningful
at all — "breaking" now has a real definition (Tier 1 export changes) to
version against, rather than a guess. But writing this RFC required
actually reading `packages/*/package.json` against the real repo
structure, and doing so surfaced that the packaging blueprints were
written BEFORE the real CLI (`cli/najm.ts`), the real build pipeline
(`server/build.ts`), and the real router (`router/router.ts`) existed —
they describe an intended shape, and that shape has drifted from what
got built. A release strategy that ships the blueprint as-is would
publish packages that don't actually contain the working code.

## Design

### Package naming (resolved 2026-07-14, at the Mono → Najm rename)

The framework was developed under the working name **Mono**. At
first-public-release preparation, the npm registry check surfaced that
`mono-core` and `create-mono-app` were already taken by unrelated
packages, and the naming decision landed on a full rebrand to **Najm**
(the `legacy/` archive retains the Mono-era record verbatim — see
`docs/rfcs/README.md`'s naming-history note). Registry facts, checked
live against npm on 2026-07-14:

```text
najm             AVAILABLE  → the core package (runtime/), bare name,
                              vue-style; its "./core" subpath export is
                              the exact `najm/core` specifier the
                              compiler emits into every compiled module
najm-compiler    AVAILABLE  → compiler/
najm-router      AVAILABLE  → router/
najm-server      AVAILABLE  → server/ (+ CLI, pending the discrepancy below)
create-najm-app  AVAILABLE  → reserved for a future standalone `npm create
                              najm-app` shim; today scaffolding is the
                              `najm create-najm-app` subcommand (RFC-0011)
najm-core        TAKEN (v2.0.1, unrelated) — why the core package is bare
                              `najm`, not `najm-core`
```

First-publish mechanics are user-owned (an npm account/login this
tooling does not hold): `npm login`, then per package
`npm publish --access public --tag beta` — gated on the workspace wiring
and the `najm-server`/`cli/` decision below actually producing
installable `dist/` output first.

### The four packages, source of truth today

```text
najm      ← runtime/        (RFC-0002/0004/0005/0006/0007/0010's surface)
najm-compiler  ← compiler/       (RFC-0003/0009 — includes the plugin loader)
najm-router    ← router/         (RFC-0008)
najm-server    ← server/ + cli/  (RFC-0006/0007/0008's server; RFC-0011's CLI)
```

Dependency direction, unchanged from `packages/README.md`:
`najm-server → najm-router → najm-compiler → najm`, with
`najm` importing nothing outside the JS/DOM standard library
(RFC-0002's boundary, enforced by `tests/test-runtime-boundary.ts`).

### The `najm-server`/`cli/` discrepancy (found, documented, not silently fixed)

`packages/najm-server/package.json` declares `"bin": { "najm":
"./dist/cli.js" }` and a `tsup` build script — written when `najm-server`
was expected to own the CLI binary. The REAL CLI that was actually built
and verified (RFC-0011) lives at the repo root: `cli/najm.ts`, a set of
plain TypeScript modules (`cli/doctor.ts`, `cli/lint.ts`,
`cli/scaffold.ts`) invoked via `tsx` (`npm run cli -- <command>`), with
**no relationship to `packages/najm-server/` at all** — it directly
imports `server/*.ts`, `router/router.ts`, `compiler/*.ts`, and
`language-server/extract.ts` by relative path, none of which resolve
once `cli/` is moved into a standalone npm package boundary.

This RFC does NOT silently move `cli/` into `packages/najm-server/src/`
and call it reconciled — RFC-0011's own Verification section already
found and documented a related, harder problem: `najm lint`'s reuse of
`language-server/extract.ts` means the CLI's real dependency graph
reaches into `language-server/`, which has NO packaging story in
`packages/` at all (there is no `najm-language-server` npm package
blueprint). Reconciling this fully means either (a) publishing a fifth
package (`najm-language-server`) that both `cli/` and a future VS Code
extension client depend on, or (b) inlining just the pieces `cli/lint.ts`
needs directly into `najm-compiler` (since `extractDocument()`'s real
logic is itself built on `compiler/parse.ts`/`compiler/semantics.ts`,
already `najm-compiler`'s territory) and keeping `language-server/` a
separate, unpublished-for-now internal tool. Recorded as this RFC's
concrete, unresolved follow-up (see Open Questions) rather than glossed
over — a release strategy that ships `najm-server` with a `bin` field
pointing at code that was never actually assembled into that package is
worse than no release strategy.

### Version numbering

Semver, tiers from RFC-0018 map directly:

```text
Tier 1 change  → major version bump, ALL FOUR packages together
Tier 2 change  → minor version bump, all four together (even if only
                 one package's own surface changed — RFC-0018's own
                 stance is that these four packages are versioned as
                 one unit, matching packages/README.md's "one version
                 line" framing; a consumer locks one version number,
                 not four independent ones)
Tier 3         → never a version-bump trigger; these were never public
```

Today's `0.3.0-dev` across all four is the pre-release baseline — no
package has published to npm yet, so no version bump has actually
happened; this RFC specifies the RULE, not a historical record.

### Promotion: dev → beta → stable

```text
0.x.y-dev     current state — every package here, right now
0.x.y-beta.N  first real npm publish, dist-tag "beta" (matching
              release.yml's existing --tag beta), once packages/'s
              actual build output (tsup or equivalent — see Open
              Questions on najm-server specifically) produces real,
              installable dist/ for all four packages
1.0.0         first STABLE release — gated on: (a) RFC-0018's Tier 1
              list having zero changes for one full beta cycle (a
              concrete, checkable bar — not a calendar date), and
              (b) RFC-0014's benchmark baseline.json having a stable,
              non-regressing history across that same cycle
```

No calendar-based release cadence (e.g., "ship every 6 weeks") — gated
on the two concrete, already-real signals above, consistent with
RFC-0001's anti-speculation stance applied to release timing.

### CI pipeline: adopt, don't replace

`.github/workflows/release.yml` (real, pre-existing) already does the
right shape: Changesets-driven versioning, `pnpm -r test`/`typecheck`/
`build` as the gate, npm provenance on publish, `beta` dist-tag. This
RFC's only change to it: the gate commands (`pnpm -r test` etc.) assume
a pnpm workspace this repo does not currently have (it uses plain `npm`
at the root, and `packages/*/package.json` files exist but aren't wired
into a `pnpm-workspace.yaml` or npm workspaces `"workspaces"` field yet)
— reconciling that wiring is a prerequisite for `release.yml` to
actually run successfully, tracked as an Open Question below, not solved
in this pass.

### What this RFC does NOT add

- No actual `pnpm-workspace.yaml`/npm workspaces wiring — real,
  concrete follow-up work, not done here (see Open Questions).
- No fix for the `najm-server`/`cli/` discrepancy beyond documenting it
  precisely — deliberately not solved in this pass; the two candidate
  fixes above both have real tradeoffs that deserve their own scoped
  decision, not a rushed one bolted onto a release-strategy RFC.
- No changelog-generation tooling beyond what Changesets already
  provides out of the box.

## Alternatives considered

- **Independent versioning per package** (najm at 2.1.0,
  najm-router at 1.4.0, etc., each on its own cadence). Rejected —
  `packages/README.md`'s own "one version line" framing predates this
  RFC and nothing in the intervening implementation work (RFC-0009
  through RFC-0018) gave a reason to revisit it; the strict one-way
  dependency chain means a consumer installing mismatched versions
  across the four packages is never a supported configuration anyway,
  so independent version numbers would only be able to lie about
  compatibility, not express it.
- **Silently "fixing" the najm-server/cli discrepancy by moving cli/
  into packages/najm-server/ as part of this RFC.** Rejected — see
  Design section above; the real dependency graph (`cli/lint.ts` →
  `language-server/extract.ts` → `compiler/semantics.ts`) means a naive
  move breaks import resolution, and the two real fixes both deserve
  their own scoped decision RFC-0019 alone shouldn't make unilaterally
  while trying to also cover versioning policy.

## Verification

- **The four packages exist and are version-consistent**: confirmed by
  direct inspection — `packages/{najm,najm-compiler,najm-router,
  najm-server}/package.json` all present, all at `0.3.0-dev`. **Done.**
- **The najm-server/cli discrepancy is real, not assumed**: confirmed
  by direct inspection — `packages/najm-server/package.json`'s `bin`
  field points at `./dist/cli.js`, built via `tsup`; the real,
  RFC-0011-verified CLI lives at `cli/najm.ts` with zero import
  relationship to `packages/najm-server/src/` (which doesn't exist —
  `packages/najm-server/` has only a `package.json`, no `src/`).
  **Done** (the finding itself is the verification).
- **`.github/workflows/release.yml` exists and is real**: confirmed by
  direct inspection, contents reproduced accurately in this RFC's
  Design section. **Done.**
- **Action item, not yet implemented**: `pnpm-workspace.yaml` (or npm
  workspaces equivalent) wiring the four `packages/*` manifests to this
  repo's actual root-level `npm test`/`typecheck`/`build` scripts, so
  `release.yml`'s `pnpm -r test` etc. would actually succeed if run
  today. Not built in this pass — see Open Questions.
- **Action item, not yet implemented**: resolving the najm-server/cli
  discrepancy (one of the two candidate fixes in Design). Not built in
  this pass — a real architectural decision, not a mechanical fix.

## Open questions

- Which of the two `najm-server`/`cli/` reconciliation paths (publish a
  fifth `najm-language-server` package, or inline `cli/lint.ts`'s
  `language-server/` dependency into `najm-compiler`)? Both are real,
  buildable options; neither has a concrete second consumer yet to
  motivate picking one over the other (RFC-0013's VS Code extension
  client, once built, would be the natural second consumer of whichever
  `language-server/` packaging decision gets made — worth deciding
  alongside that work, not before it).
- Should the pnpm-workspace wiring happen as part of RFC-0019's own
  follow-up, or is it properly RFC-0018/RFC-0001's territory (the
  "how does najm actually get published" mechanics predate this
  RFC's versioning-policy scope)? Leaning toward: a small, focused
  follow-up task, not a new RFC — the workspace wiring is mechanical
  once the najm-server/cli decision above is made (the workspace config
  needs to know where the CLI binary actually lives).
