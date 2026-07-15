# Routing and SSR

Files under `src/pages` become routes. `index.najm` maps to its directory, `[id].najm` captures one parameter, and `[...path].najm` captures the remainder. Resolution includes nested layouts and middleware.

## Request flow

Middleware runs before rendering and may continue, redirect, or return a response. The router resolves a page and params, layouts compose around it, and the runtime creates a request-local render context. Never store request data in module-level signals.

## HTML first

SSR escapes text and attributes by default. Static components stop at HTML. Components with interaction can emit island metadata and hydrate independently with `client:load` or `client:visible`.

Use `client:load` when interaction must work immediately. Use `client:visible` for below-the-fold or expensive controls. See [Islands and hydration](/learn/islands-and-hydration) for the complete lifecycle.
