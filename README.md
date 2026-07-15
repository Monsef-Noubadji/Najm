# Najm

**Ship HTML first. Hydrate only interaction.** Najm is a compiler-first reactive framework with fine-grained signals, SSR, file routing, and zero-JavaScript-by-default islands.

[Engineering documentation](https://monsef-noubadji.github.io/Najm/) | [Getting started](https://monsef-noubadji.github.io/Najm/guide/introduction) | [API reference](https://monsef-noubadji.github.io/Najm/reference/runtime) | [Contributing](https://monsef-noubadji.github.io/Najm/contributing/)

> Najm is currently `0.3.0-beta`. Review the [beta adoption policy](https://monsef-noubadji.github.io/Najm/guide/beta-status) before production use.

## Why Najm

- Static components produce useful HTML with no framework JavaScript.
- Interactive components hydrate as isolated `client:load` or `client:visible` islands.
- Signals update generated DOM bindings directly, without virtual-DOM diffing.
- The compiler validates template identifiers and emits coordinated SSR and claim code.
- File routes support layouts, middleware, dynamic segments, and static generation.

## Install

Node.js 20 or newer is required.

```bash
npm install @monsef-nbj/najm@beta @monsef-nbj/najm-compiler@beta @monsef-nbj/najm-router@beta @monsef-nbj/najm-server@beta
```

```ts
import { signal } from '@monsef-nbj/najm/core';

const count = signal(0);
```

The standalone CLI is not published in this beta. Follow the [Vite setup](https://monsef-noubadji.github.io/Najm/guide/getting-started) for application integration.

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
