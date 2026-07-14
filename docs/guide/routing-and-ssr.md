# Routing & SSR

The filesystem is the route table: every `.najm` file under `src/pages/`
becomes a route, and the two structural filenames — `layout.najm` and
`middleware.ts` — compose around the pages below them. All examples on this
page are the real, working routes shipped in this repository's `src/pages/`.

## Route types

| File | Route | Notes |
| --- | --- | --- |
| `src/pages/index.najm` | `/` | |
| `src/pages/about.najm` | `/about` | |
| `src/pages/blog/index.najm` | `/blog` | `index` collapses into the directory |
| `src/pages/greet/[name].najm` | `/greet/:name` | dynamic segment → `props.params.name` |
| `src/pages/docs/[...slug].najm` | `/docs/*` | catch-all → `props.params.slug` (an **array** of segments) |
| `src/pages/layout.najm` | — | wraps every page below it (never a route itself) |
| `src/pages/middleware.ts` | — | runs before every page below it (never a route itself) |

When several routes could match, specificity wins: static segments beat
dynamic segments beat catch-alls — `/docs/intro` matches `docs/intro.najm`
before `docs/[slug].najm` before `docs/[...slug].najm`.

In dev, routes are re-scanned per request — adding a page is instantly
live, no restart. Production builds precompute the route table once.

## Pages

A page is an ordinary component (see [Components](components.md)) that the
server renders once per request. It never hydrates itself — only the
islands it contains do.

### Dynamic segments — `props.params`

The router injects matched URL segments as `props.params`. This is the real
`src/pages/greet/[name].najm` (in legacy SFC style; a functional page reads
`props.params` the same way):

```html
<script>
  // Dynamic route: src/pages/greet/[name].najm → /greet/:name
  // The router injects matched segments as props.params.
  const name = props.params.name;
</script>

<template>
  <main>
    <h1>Hello, {name}!</h1>
  </main>
</template>
```

For a catch-all route (`[...slug].najm`), `props.params.slug` is an array —
`/docs/a/b` yields `["a", "b"]`.

## Layouts

A `layout.najm` file wraps **every page at or below its directory**. The
page's rendered HTML arrives as `props.children`, and the layout embeds it
with `{@html}` (the one legitimate use of raw-HTML interpolation — the
string is framework-produced, already-escaped page output). This repo's
real root layout:

```js
export default function RootLayout(props = {}) {
  const children = props.children;
  return {
    template: `
      <div class="site">
        <nav><a href="/">Najm</a></nav>
        {@html children}
      </div>
    `,
    style: `
      .site nav { padding: 0.75rem 1.5rem; border-bottom: 1px solid #e5e5e5; }
    `,
  };
}
```

Layouts **nest**: `src/pages/layout.najm` wraps `src/pages/blog/layout.najm`
wraps `src/pages/blog/post.najm`, rendered innermost-out.

## Middleware

A `middleware.ts` file next to (or above) a page runs **before that page
renders** — auth checks, redirects, header injection. The contract is
deliberately small:

```ts
export default function middleware(ctx: MiddlewareContext): MiddlewareResult
```

- `ctx` carries `pathname`, `params`, and `headers` (raw request headers,
  lowercased keys).
- The return value is one of:
  - `{ type: 'next' }` (or just returning nothing) — continue;
  - `{ type: 'redirect', to, status? }` — redirect (`301 | 302 | 307 | 308`,
    default 302);
  - `{ type: 'reject', status, body? }` — short-circuit with an error
    response before the page ever renders.
- Sync or async — the router awaits either. Middleware files stack
  outermost-first (root middleware runs before a nested directory's), and
  the first non-`next` result short-circuits the chain.

The real guard shipped at `src/pages/admin/middleware.ts`, protecting
everything under `/admin`:

```ts
import type { MiddlewareContext, MiddlewareResult } from '../../../router/middleware';

export default function middleware(ctx: MiddlewareContext): MiddlewareResult {
  if (ctx.headers['x-najm-admin'] !== 'yes') {
    return { type: 'reject', status: 403, body: 'Forbidden — missing x-najm-admin header' };
  }
  return { type: 'next' };
}
```

Try it: `curl http://localhost:3000/admin` returns the 403 body;
`curl -H "x-najm-admin: yes" http://localhost:3000/admin` renders the page.

## The SSR model: zero JS by default

Every page is server-rendered to HTML. A page with no islands ships **zero
bytes of framework JavaScript** — view the source of `/about` in this repo
and there is no `<script>` tag at all. This is a hard-gated benchmark in
Najm's test suite, not an aspiration.

Interactivity is opt-in per component use-site. A component tag without a
directive is a **static include**: it renders on the server and ships no
JS. Adding a `client:*` directive makes that use an **island**:

```html
<TodoList client:load initial={["Ship Najm v1.0", "Keep the runtime small"]} />
```

## Islands

- **`client:load`** — hydrates eagerly, as soon as the page's bootstrap
  script runs.
- **`client:visible`** — partial hydration: the island's JavaScript module
  is **not fetched at all** until the island scrolls near the viewport. An
  `IntersectionObserver` with a `200px` root margin triggers the dynamic
  `import()` slightly *before* the element is on screen, so on typical
  scroll speeds hydration finishes before the user reaches it; each
  observer fires once and disconnects. (If the browser lacks
  `IntersectionObserver`, Najm fails open and hydrates immediately.)

Hydration never re-renders: the generated hydrate function performs a
claim-walk that **adopts** the server-rendered DOM node by node, attaching
one small effect per dynamic binding and one listener per event. Because
island props cross the server/client boundary, they must be serializable.

Each island becomes its own hashed chunk in the production build, sharing
one runtime (~7.7 kB gzipped) paid once per island-bearing page. A live
demo of `client:visible` ships at `src/pages/partial-hydration-demo.najm`.

## Static pre-rendering vs request-time rendering

`najm build` classifies every route (the real rules from the build
pipeline):

- **Static (pre-rendered at build time)** — the route has **no dynamic
  segments** and **no middleware** anywhere in its ancestry. It is rendered
  once to an HTML file in `dist/static/` and served as a plain file.
- **Request-time (dynamic)** — the route has a `[param]`/`[...catchAll]`
  segment (there is no static-paths enumeration mechanism, so concrete
  URLs can't be known at build time) **or** is guarded by middleware
  (middleware must observe the real request, so pre-rendering would bypass
  it). These routes are compiled to plain Node ESM modules in
  `dist/server/` and rendered per request by the production server — still
  fully SSR, just not pre-rendered.

In this repo's build, that classification comes out as:

```text
  najm build — 7 route(s) found
    static:  /about, /error-boundary-demo, /, /partial-hydration-demo, /testing
    dynamic: /admin, /greet/[name]
```

`/greet/[name]` is request-time because of its dynamic segment; `/admin` is
request-time because of its middleware — note it has no dynamic segments.

See the [CLI reference](cli.md) for the full build output and the `dist/`
layout, and [RFC-0008](../rfcs/RFC-0008-routing.md) if you want the
architecture rationale behind the router.
