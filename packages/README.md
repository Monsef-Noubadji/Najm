# Najm npm packages

Najm publishes four ESM-only packages on one fixed version line:

| Package | Source entrypoints | Public surface |
| --- | --- | --- |
| `@monsef-nbj/najm` | `runtime/index.ts` | Reactivity, lifecycle, DOM bindings, hydration, and SSR helpers |
| `@monsef-nbj/najm-compiler` | `compiler/` | Compiler APIs, Vite plugin, and plugin types |
| `@monsef-nbj/najm-router` | `router/` | File-based routing and middleware |
| `@monsef-nbj/najm-server` | `server/` | Executable development, production-build, and preview server entries |

The package directories are distribution boundaries, not duplicate source
trees. Their tsup configurations compile the repository's root source files
into package-local `dist/` directories. Najm-owned relative imports are
bundled, while third-party host integrations such as Vite remain peer
dependencies. This makes each tarball independently installable without
moving or copying the source of truth.

## Public entrypoints

```text
@monsef-nbj/najm
@monsef-nbj/najm/core
@monsef-nbj/najm-compiler
@monsef-nbj/najm-compiler/vite
@monsef-nbj/najm-compiler/plugin-api
@monsef-nbj/najm-router
@monsef-nbj/najm-router/middleware
@monsef-nbj/najm-server/dev
@monsef-nbj/najm-server/build
@monsef-nbj/najm-server/serve
```

`@monsef-nbj/najm-compiler/vite` aliases the compiler package's main entrypoint. There is
currently no published `najm` executable: the repository CLI still depends on
unpublished language-server code and remains a development tool until that
boundary is designed and packaged. The `@monsef-nbj/najm-server/*` modules are side-effectful
tooling entrypoints and are not application import APIs.

## Release flow

The root npm workspace owns installation and release tooling:

```sh
npm ci
npm test
npm run typecheck
npm run build:packages
npm run pack:packages
```

Changesets keeps all four package versions fixed together. CI publishes the
prerelease line with `npm run release`, npm provenance, and the `beta` dist-tag.
See RFC-0018 and RFC-0019 for stability and promotion policy.
