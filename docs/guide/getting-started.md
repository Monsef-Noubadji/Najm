# Getting started

## Prerequisites

Use Node.js 20 or newer and npm. The CLI remains deferred and repository-only, so adopters configure Vite and package scripts directly.

## Install

```bash
npm install @monsef-nbj/najm@next @monsef-nbj/najm-compiler@next @monsef-nbj/najm-router@next @monsef-nbj/najm-server@next
npm install --save-dev vite@^6 typescript@^5.7
```

Configure the compiler in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { najm } from '@monsef-nbj/najm-compiler/vite';

export default defineConfig({ plugins: [najm()] });
```

Add application scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "node --import @monsef-nbj/najm-server/dev",
    "build": "node --import @monsef-nbj/najm-server/build",
    "preview": "node --import @monsef-nbj/najm-server/serve"
  }
}
```

## Your first component

Create `src/pages/index.najm`:

```najm
<script>
import { signal } from '@monsef-nbj/najm/core';
const count = signal(0);
</script>

<h1>Najm is rendering HTML</h1>
<button (click)={count.value++}>Count: {count}</button>
```

The heading is server HTML. The event makes this component interactive, so the compiler emits the claim and binding code required to hydrate it.

## Development loop

Run `npm run dev` to start development, `npm run build` to create production output, and `npm run preview` to serve that output. These scripts execute the published server tooling modules without requiring a global CLI.

Continue with [Components](./components) and [Routing and SSR](./routing-and-ssr).
