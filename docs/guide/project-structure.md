# Project structure

Najm maps filesystem conventions to rendering behavior.

```text
src/
  components/       reusable .najm components
  pages/            file routes
    index.najm      /
    users/[id].najm /users/:id
    [...path].najm  catch-all route
  layout.najm       root layout
  middleware.ts     request middleware
```

Keep route components focused on request data and composition. Put reusable visual units in `components/`, cross-cutting request policy in middleware, and shared document structure in layouts. Nested route directories may provide nested layouts.

Generated output is build material, not source. Do not commit compiler artifacts unless a deployment platform explicitly requires them.
