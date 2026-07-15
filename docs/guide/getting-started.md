# Getting started

## Prerequisites

Use Node.js 20 or newer and pnpm.

## Create a project

```bash
pnpm dlx @monsef-nbj/najm create my-app
cd my-app
pnpm run dev
```

The create command writes a starter app, installs dependencies with pnpm, and adds the standard project scripts:

```json
{
  "scripts": {
    "dev": "najm dev",
    "build": "najm build",
    "preview": "najm preview",
    "lint": "najm lint",
    "doctor": "najm doctor"
  }
}
```

## Manual install

If you are adding Najm to an existing project, install the coordinated packages directly:

```bash
pnpm add @monsef-nbj/najm @monsef-nbj/najm-compiler @monsef-nbj/najm-router @monsef-nbj/najm-server vite
pnpm add -D typescript tsx
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
    "dev": "najm dev",
    "build": "najm build",
    "preview": "najm preview",
    "lint": "najm lint",
    "doctor": "najm doctor"
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

<template>
  <h1>Najm is rendering HTML</h1>
  <button (click)={count.value++}>Count: {count}</button>
</template>
```

The heading is server HTML. The event makes this component interactive, so the compiler emits the claim and binding code required to hydrate it.

## Development loop

Run `pnpm run dev` to start development, `pnpm run build` to create production output, and `pnpm run preview` to serve that output. Use `pnpm run doctor` when setup fails or before opening a release issue.

Continue with [Components](./components) and [Routing and SSR](./routing-and-ssr).
