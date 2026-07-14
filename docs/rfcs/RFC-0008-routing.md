# RFC-0008: Routing

- **Status:** Implemented
- **Depends on:** RFC-0002, RFC-0006
- **Formalizes:** `router/router.ts`, `router/middleware.ts`,
  and the `server/dev.ts` wiring that connects them (all implemented and
  verified — see Verification)

## Summary

The filesystem is the route table: `src/pages/**/*.najm` maps directly to
URL paths, with `[param]` and `[...catchAll]` segments, `layout.najm`
files that nest around every page beneath them, and `middleware.ts` files
that run before rendering and can redirect or reject a request. Routing
lives in a separate package (`najm-router` in the target repository
structure, RFC-0002's package boundary) that depends on `najm` — it
is not part of the core runtime, resolving RFC-0001's open question in
favor of "always optional, imported explicitly."

## Motivation

File-based routing is the Next.js idea the original brainstorming
correctly kept, and the implementation (route table construction, param
matching, catch-all segments, layout/middleware discovery via directory
ancestry) is sound. What this RFC adds is: (1) a formal decision that
routing is a separate package, not baked into `najm`, consistent with
RFC-0001's small-core mandate, and (2) closing the gap between what
`router.ts`/`middleware.ts` already specify and what the dev server
(`dev.ts`) actually executes — currently the router computes
`layouts`/`middlewares` arrays that the server never reads.

## Design

### Route resolution (implemented, formalized here)

```text
src/pages/index.najm              →  /
src/pages/about.najm               →  /about
src/pages/greet/[name].najm        →  /greet/:name        params.name: string
src/pages/docs/[...slug].najm      →  /docs/*              params.slug: string[]
```

Specificity ordering at match time: static segments beat single dynamic
segments beat catch-all segments, so `/docs/intro` matches a literal
`docs/intro.najm` before `docs/[slug].najm` before `docs/[...slug].najm`.
`layout.najm` and `middleware.ts` are structural filenames, excluded from
the route table itself (never directly reachable as a page).

### Layout composition (specified; wires existing `{@html}` primitive)

```text
src/pages/layout.najm              wraps every page
src/pages/blog/layout.najm         wraps pages under blog/, nested inside
                                    the root layout (outermost-to-innermost)
```

A layout is an ordinary component (RFC-0002's `FunctionalComponent`
contract) that receives the already-rendered page HTML as a `children`
prop (a plain string) and embeds it via `{@html children}` — the raw,
unescaped interpolation primitive added specifically for this purpose
(compiler support already implemented: `parse.ts`'s `{@html}` grammar,
rejected inside islands/each-blocks since it is server-composition-only,
per its own doc comment in `parse.ts`). Composition order:
`resolvePage()`'s `layouts` array is outermost-first; the server renders
the page first, then wraps its output in each layout from innermost to
outermost (i.e., iterating the array in reverse).

### Middleware (implemented; contract formalized here)

```ts
export default function middleware(ctx: MiddlewareContext): MiddlewareResult
```

stacks outermost-first (root `middleware.ts` runs before a nested
directory's), matching layout nesting order for consistency. Any
middleware in the chain can short-circuit with `{ type: 'redirect', to }`
or `{ type: 'reject', status }`; `runMiddlewareChain()` is deliberately
framework/HTTP-library-agnostic (no Node `http` types in its signature) so
it is unit-testable without a server and portable to a future non-Node
adapter (RFC-0011's CLI may target edge runtimes later).

### Server wiring (this RFC's concrete deliverable)

`renderPage()` in `dev.ts` must, in order:

1. Resolve the route via `resolvePage()`, obtaining `{ file, params,
   layouts, middlewares }`.
2. Load each middleware module (`vite.ssrLoadModule`) and run
   `runMiddlewareChain()` against a `MiddlewareContext` built from the
   request. A `redirect` result writes a 30x with `Location`; a `reject`
   result writes the given status and stops before the page ever renders.
3. If the chain returns `null` (all middleware said "next"), render the
   page as today, then fold the result through each loaded layout module
   (innermost to outermost) before passing to `shell()`.

This is additive to the existing `renderPage` implementation — pages with
no `layout.najm`/`middleware.ts` in their ancestry see zero behavior
change, since `layouts`/`middlewares` are empty arrays for them.

## Alternatives considered

- **Routing built into `najm`.** Rejected — RFC-0001's small-core
  mandate and the review's explicit plugin-architecture guidance ("router"
  is listed under "Runtime" in the review's proposed API categories, but
  as a categorization of concerns, not a mandate that it ships inside the
  core package). A user building a single-component embed (e.g., an
  island dropped into an existing non-Najm site) should not pay for
  routing code they never call.
- **Config-based routing (a `routes.ts` manifest) instead of file-based.**
  Rejected — file-based routing was correctly identified as a strength in
  the original brainstorming and the review doesn't challenge it; no
  motivation to revisit.

## Verification

- Route matching (`tests/test-router.ts`, 16 cases): specificity
  ordering (static beats dynamic beats catch-all), index resolution,
  catch-all array params, `layout.najm`/`middleware.ts` correctly excluded
  from the page table, layout/middleware discovery walking directory
  ancestry correctly (outermost-first, scoped to the declaring directory
  and its descendants only). **Done.**
- Middleware chain (`tests/test-router.ts`): all-next resolves to render;
  a redirect short-circuits later middleware in the chain; a reject
  carries its status/body; async middleware is awaited in the declared
  order. **Done.**
- End-to-end, verified against a running dev server: `/` and `/about`
  (siblings, both under the root `layout.najm`) both render wrapped in
  `<div class="site"><nav>...</nav>{page content}</div>` — confirming
  layout composition and `{@html children}`. A request to `/admin`
  without the required header receives a real `403` with the
  middleware's exact body and the page's `ssr()` never runs (no HTML
  shell in the response); the same request WITH the header renders the
  admin page's content correctly wrapped in the root layout, proving
  middleware and layout composition combine correctly. `/greet/ada`
  (an unrelated dynamic-param route) is unaffected by any of this
  wiring. **Done** — see `src/pages/layout.najm`,
  `src/pages/admin/middleware.ts`, `src/pages/admin/index.najm` for the
  example routes exercised.

## Open questions

- Should middleware be able to inject data the page reads (e.g., an
  authenticated user object), or is header/redirect control the entire
  surface? Currently scoped to control-flow only (next/redirect/reject);
  a data-passing mechanism would need its own design once a concrete use
  case motivates it, consistent with RFC-0001's anti-speculation stance.
