# Najm

**Ship HTML first. Hydrate only interaction.** Najm is a compiler-first reactive framework with fine-grained signals, SSR, file routing, and zero-JavaScript-by-default islands.

[Engineering documentation](https://monsef-noubadji.github.io/Najm/) | [Getting started](https://monsef-noubadji.github.io/Najm/guide/introduction) | [API reference](https://monsef-noubadji.github.io/Najm/reference/runtime) | [Contributing](https://monsef-noubadji.github.io/Najm/contributing/)

> Najm `1.0.0` is the first stable release. Najm `1.1.0-rc.1` adds the published CLI hardening release with build render timings. Review the [release status](https://monsef-noubadji.github.io/Najm/guide/release-status) for compatibility and support policy.

## Why Najm

- Static components produce useful HTML with no framework JavaScript.
- Interactive components hydrate as isolated `client:load` or `client:visible` islands.
- Signals update generated DOM bindings directly, without virtual-DOM diffing.
- The compiler validates template identifiers and emits coordinated SSR and claim code.
- File routes support layouts, middleware, dynamic segments, and static generation.

## Create an app

Node.js 20 or newer and pnpm are required.

```bash
pnpm dlx @monsef-nbj/najm create my-app
cd my-app
pnpm run dev
```

The `@monsef-nbj/najm` package now ships the `najm` and `create-najm-app` binaries. Generated apps include scripts for the normal engineering loop:

```bash
pnpm run doctor
pnpm run lint
pnpm run build
pnpm run preview
```

`najm test` remains deferred in this release; use your project's `package.json` test script.

## Runtime import

```ts
import { signal } from '@monsef-nbj/najm/core';

const count = signal(0);
```

For existing projects, follow the [manual Vite setup](https://monsef-noubadji.github.io/Najm/guide/getting-started) and install the coordinated packages at the same version.

## Repository development

```bash
npm ci
npm test
npm run typecheck
npm run build:packages
npm run docs:dev
```

Architecture decisions live in [20 canonical RFCs](docs/rfcs/README.md). Contributions use test-first validation and Changesets; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
