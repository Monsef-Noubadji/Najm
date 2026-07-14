# Legacy / Archived Code

> **Note (2026-07-14):** the framework was renamed **Mono → Najm** at
> first-public-release preparation. This archive deliberately keeps the
> Mono-era naming (`.mono` files, `mono/core` imports, `[mono]` prefixes)
> verbatim — it is a historical record, and renaming it would falsify it.

Code moved here on 2026-07-13 per the architecture review
(`Mono_Framework_Architecture_Review_and_Strategy.md`), which identified two
patterns as the project's biggest risk to reaching a shippable v1: embedding
other frameworks' runtimes directly into Mono's core, and building
resumability (Qwik-style serialized-closure hydration) as a v1 feature
instead of v2+ research.

Nothing here is deleted — it is real, working, previously browser-verified
code — but it is out of the active build (`compiler/`, `runtime/`,
`router/`, `server/`, `src/`, `tests/` no longer import any of it) because
it conflicts with the direction set by the review and by
`docs/rfcs/RFC-0002-runtime-architecture.md`. (The active tree was
`framework/{runtime,compiler,server}` at archival time and was flattened
to top-level `compiler/`, `runtime/`, `router/`, `server/` in a later pass
— paths below are relative to `legacy/` itself, which kept its original
internal layout.)

## What's here and why

- **`framework/runtime/resume.ts`, `bootloader.ts`, `framework/compiler/resume-codegen.ts`**
  — the resumability prototype (QRL-based lazy hydration, serialized signal
  graphs, event delegation bootloader). Real, tested, proven end-to-end in a
  browser. Superseded by the review's roadmap: SSR → Islands → Partial
  Hydration → Progressive Hydration → Resumability (v2+, treated as a
  research project requiring serialization of execution state, lexical
  scopes, closures, and dependency graphs — not a compiler flag).

- **`framework/interop/react.ts`, `interop/vue.ts`** — adapters that made
  React/Vue components speak Mono's internal component ABI directly
  (`(props) => { ssr, hydrate }`), so their runtimes ran inside Mono's
  render/hydration pipeline. Superseded by the review's interop model:
  `Mono Component → Web Component → {React,Vue,Angular} Wrapper`, which
  keeps DOM ownership unambiguous and doesn't require Mono's core to know
  React or Vue exist.

- **`src/components/ReactCounter.tsx`, `VueLikes.ts`, `ResumableCounter.mono`,
  `src/pages/resumable.mono`** — example pages/components exercising the
  above.

- **`scripts/test-resumability.ts`** — its test suite.

- **`docs/MANUAL.md`** — the Beta-era technical manual describing the
  meta-islands/resumability-as-v1 architecture as current. Superseded by
  the RFC series (`docs/rfcs/`), which documents the actual current
  architecture and is kept up to date as it evolves; this file is
  historical record only.

## If you need to revisit this later

The resumability prototype's mechanism (QRL parsing, serialized graph,
delegated bootloader, WeakMap-cached resumed state) is sound and was
regression-tested, including a real state-persistence bug found and fixed
during browser verification. It is a reasonable starting point for the v2+
research effort the review calls for — it is not being thrown away, only
deferred.
