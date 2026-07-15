# Routing and SSR

Files under `src/pages` become routes. `index.najm` maps to its directory, `[id].najm` captures one parameter, and `[...path].najm` captures the remainder. Resolution includes nested layouts and middleware.

## Request flow

Middleware runs before rendering and may continue, redirect, or return a response. The router resolves a page and params, layouts compose around it, and the runtime creates a request-local render context. Never store request data in module-level signals.

## HTML first

SSR escapes text and attributes by default. Static components stop at HTML. Components with interaction can emit island metadata and hydrate independently with `client:load` or `client:visible`.

Use `client:load` when interaction must work immediately. Use `client:visible` for below-the-fold or expensive controls. See [Islands and hydration](/learn/islands-and-hydration) for the complete lifecycle.

## Dynamic route

Create `src/pages/users/[id].najm`:

```najm
<script>
const id = props.params.id;
</script>

<template><h1>User {id}</h1></template>
```

## Root layout

Create `src/pages/layout.najm`. Layouts receive rendered child HTML through `props.children`; use raw HTML only for this trusted framework output.

```najm
export default function RootLayout(props = {}) {
  const children = props.children;
  return {
    template: `<div class="shell"><nav><a href="/">Home</a></nav>{@html children}</div>`,
  };
}
```

## Redirect middleware

Create `src/pages/legacy/middleware.ts` to guard every route in that directory:

```ts
import type { MiddlewareResult } from '@monsef-nbj/najm-router/middleware';

export default function middleware(): MiddlewareResult {
  return { type: 'redirect', to: '/', status: 302 };
}
```
