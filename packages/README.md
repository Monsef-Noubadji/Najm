# Najm npm distribution — blueprints

Najm ships as **three packages with one version line** (the pnpm/changesets
monorepo discipline that React, Vue, and Astro all converged on):

| Package | Source of truth today | What it exports | Runs in |
| --- | --- | --- | --- |
| `najm` | `runtime/` | signals, lifecycle, mount, DOM bindings, hydration, SSR helpers | browser **and** Node (must stay dependency-free at its heart) |
| `najm-compiler` | `compiler/` | `compile()`, `parseTemplate()`, and the Vite plugin (`najm-compiler/vite`) | Node (build time) |
| `najm-router` | `router/` | `resolvePage()`, `runMiddlewareChain()` — file-based routing, layouts, middleware (RFC-0008) | Node |
| `najm-server` | `server/` | the dev/SSR server, `najm dev` CLI | Node |

Dependency direction is strictly one-way and enforced by the split itself:

```text
najm-server ──▶ najm-router ──▶ najm-compiler ──▶ najm
                                                       ▲
                    user code ─────────────────────────┘   (imports ONLY najm at runtime)
```

Per RFC-0001's small-core mandate and RFC-0002's explicit boundary
decision, `najm` has **no** framework-interop subpath (no
`najm/interop/react`, no `najm/interop/vue`). Cross-framework
interop happens at the Web Component boundary — see RFC-0002 — which
needs no special code in `najm` at all.

## Design rules (the parts people get wrong)

1. **`najm` has zero runtime dependencies, full stop** — not even
   optional peers. There is nothing UI-framework-specific in this package
   to make optional; RFC-0002's Web Component boundary means `najm`
   never imports, or dynamically imports, React/Vue/Angular.
2. **`sideEffects: false` everywhere.** The runtime is pure modules; a page
   that only uses signals must tree-shake to ~1.5 kB. One accidental top-level
   side effect breaks that for every user, so CI should gate on bundle size.
3. **ESM-only, with real `exports` maps.** Dual CJS/ESM packages are a tax
   everyone has stopped paying. `exports` seals internals
   (`./dist/internal/*` is not importable).
4. **The compiler pins nothing about Vite.** `vite` is a peer dependency with
   a wide range; `transformWithEsbuild` is the only API surface we touch.
5. **Types ship from source.** `tsup` emits `.d.ts` next to each entry; no
   `@types/najm-*` split, ever.

## Versioning & release flow

See RFC-0018 (Public API Stability) and RFC-0019 (Release Strategy) — both
currently Stubs, deferred until the public API surface across
RFC-0002–0008 has settled. `.github/workflows/release.yml` has an early
draft of the changesets/provenance publish flow, predating those RFCs, to
be reconciled once they're drafted.

## Migration of this repo (mechanical, when we flip the switch)

The repo was flattened out of `framework/` into top-level `compiler/`,
`runtime/`, `router/`, `server/` directories already (see each directory
directly, no `framework/` wrapper remains). What's left to become real npm
packages:

1. `git mv runtime packages/najm/src`,
   `compiler → packages/najm-compiler/src`,
   `router → packages/najm-router/src`,
   `server → packages/najm-server/src`.
2. Replace the dev server's aliases with real workspace deps
   (`"najm": "workspace:*"`, etc.).
3. Compiled output already imports `najm/core` — rename the specifier to
   `najm` in `codegen.ts` (one constant: `RUNTIME`).
4. `pnpm -r build && pnpm -r test`, then `pnpm changeset publish`.
