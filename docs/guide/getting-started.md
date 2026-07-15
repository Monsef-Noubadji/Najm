# Getting started

## Prerequisites

Use Node.js 20 or newer and npm. The beta CLI is repository-only, so adopters should configure Vite directly rather than depending on a globally installed `najm` command.

## Install

```bash
npm install @monsef-nbj/najm@beta @monsef-nbj/najm-compiler@beta @monsef-nbj/najm-router@beta @monsef-nbj/najm-server@beta
npm install --save-dev vite@^6 typescript@^5.7
```

Configure the compiler in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { najm } from '@monsef-nbj/najm-compiler/vite';

export default defineConfig({ plugins: [najm()] });
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

In the Najm repository, `npm run dev` starts the development server, `npm run build` creates production output, and `npm run serve` previews it. Until the standalone project scaffolder is published, use those server entry modules as the canonical executable workflow.

Continue with [Components](./components) and [Routing and SSR](./routing-and-ssr).
