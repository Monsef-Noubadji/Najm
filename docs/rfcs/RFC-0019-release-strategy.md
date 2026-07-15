# RFC-0019: Release Strategy

- **Status:** Implemented
- **Depends on:** RFC-0018 (Public API Stability, Accepted)

## Summary

Najm publishes four scoped packages on one version line: `@monsef-nbj/najm`,
`@monsef-nbj/najm-compiler`, `@monsef-nbj/najm-router`, and
`@monsef-nbj/najm-server`. npm workspaces provide the distribution
boundary, Changesets versions the four packages as a fixed group, and GitHub
Actions publishes beta releases with npm provenance.

The packages build from the repository's existing root source directories.
Package-local tsup configurations bundle Najm-owned relative imports into each
artifact and leave host dependencies such as Vite external. No source move or
duplicate package source tree is required.

## Package names

The framework was developed under the working name Mono and renamed to Najm
before its first public release. The npm names checked on 2026-07-14 were:

```text
@monsef-nbj/najm             runtime package
@monsef-nbj/najm-compiler    compiler and Vite plugin
@monsef-nbj/najm-router      router and middleware
@monsef-nbj/najm-server      executable server entry modules
create-najm-app  available; reserved for a future standalone creator
najm-core        taken by an unrelated package
```

The public packages use the npm account scope because unscoped first-publish
names triggered npm's similarity protection. `@monsef-nbj/najm/core` is the
runtime alias required by the compiler's generated imports.

## Distribution model

The package directories contain manifests, documentation, build configuration,
and generated `dist/` output. Source remains in `runtime/`, `compiler/`,
`router/`, and `server/`.

```text
@monsef-nbj/najm                 <- runtime/index.ts
@monsef-nbj/najm-compiler        <- compiler/ plus a package public-entry shim
@monsef-nbj/najm-router          <- router/ plus a package public-entry shim
@monsef-nbj/najm-server/dev      <- server/dev.ts
@monsef-nbj/najm-server/build    <- server/build.ts
@monsef-nbj/najm-server/serve    <- server/serve.ts
```

The artifacts are self-contained rather than expressing dependencies on one
another. This matches the current relative-import source graph and prevents
workspace-only dependency specifiers from leaking into published manifests.
Vite is a peer dependency of the compiler and server packages. The three
`@monsef-nbj/najm-server/*` exports execute immediately when loaded; smoke verification
therefore resolves those exports without importing them.

## CLI scope

The repository CLI in `cli/` is not part of the first npm publication. It
imports unpublished language-server code, so the old `najm-server` `bin` entry
pointed to an output that no build produced. The package no longer advertises
that binary. A future RFC may extract the linting boundary or package the
language server before publishing a `najm` executable.

## Versioning

Changesets configures the four package names as a fixed group. RFC-0018's tiers
map to SemVer as follows:

```text
Tier 1 change -> coordinated major bump
Tier 2 change -> coordinated minor bump
Tier 3 change -> no public versioning effect
```

All four packages entered the registry at `0.3.0-beta.0` under the `beta`
dist-tag. Stable `1.0.0` requires one complete
beta cycle with no Tier 1 changes and a non-regressing RFC-0014 benchmark
history.

## Release pipeline

The root package is an npm workspace over `packages/*`. The release workflow
runs:

```text
npm ci
npm test
npm run typecheck
npm run build:packages
npm run release
```

`npm run release` delegates to `changeset publish --tag beta`. GitHub Actions
provides `NPM_TOKEN`, `GITHUB_TOKEN`, and an OIDC identity for npm provenance.
Local first-publish checks use `npm pack`; actual publication remains gated on
the package owner's npm login.

## Verification

- All four manifests exist at version `0.3.0-beta.0`.
- `npm run build:packages` produces JavaScript, source maps, and declarations
  for every declared export.
- `npm pack --workspaces` produces four tarballs containing only declared
  distribution files.
- Packed tarballs are installed into a clean smoke project and every public
  entrypoint is imported.
- The repository test suite and typecheck pass before publication.

## Deferred work

- Publish the CLI only after its language-server dependency has a supported
  package boundary.
- Add `create-najm-app` when scaffolding becomes a standalone package.
- Promote `beta` to `latest` only after the stability gates above are met.
