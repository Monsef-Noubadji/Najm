# Najm — User Guide

Najm (نجم — "star" in Arabic) is a **compiler-first reactive framework that
ships JavaScript only where user interaction requires it**. You write
components as plain functions with tagged templates; the compiler statically
extracts each template and replaces it with two generated closures — a
server-side string builder and a client-side hydration claim-walk. There is
no Virtual DOM and no reconciliation: hydration *adopts* the server-rendered
DOM node by node, and fine-grained signals update exactly the DOM nodes that
display a changed value.

The default output of a Najm page is HTML with **zero bytes** of framework
JavaScript (a hard-gated benchmark in this repo, not a slogan). Interactivity
is opt-in per component: mark a component `client:load` or `client:visible`
and it becomes an *island* that brings exactly its own JavaScript to the
page. Routing is file-based (`src/pages/**`) with nested layouts, middleware,
dynamic segments, and a production build that pre-renders every route it can
to static HTML.

Najm is a **beta** (`0.3.0-beta.0`). The runtime, compiler, router, and server
artifacts are published under npm's `beta` tag. The CLI remains repository-only
until its language-server dependency has a supported package boundary. API
stability tiers are defined in
[RFC-0018](../rfcs/RFC-0018-public-api-stability.md).

## The guide

1. **[Getting started](getting-started.md)** — from zero to a running app:
   scaffolding, the dev server, your first edit, and a production build.
2. **[Components](components.md)** — the component model, signals and
   reactivity, the full template syntax, lifecycle hooks, error boundaries,
   the store, and context.
3. **[Routing & SSR](routing-and-ssr.md)** — file-based routes, dynamic
   segments, layouts, middleware, the zero-JS-by-default SSR model, and
   islands.
4. **[CLI reference](cli.md)** — all six `najm` commands and what a
   production build produces.

## For architecture readers

This guide is for **app developers using Najm**. If you want to know how
Najm itself works — compiler pipeline, reactivity internals, scheduler,
hydration protocol — the [RFC index](../rfcs/README.md) is the architecture
record: twenty RFCs, each with a Verification section citing the real tests
that prove it. Start with
[RFC-0001 (Vision & Philosophy)](../rfcs/RFC-0001-vision-and-philosophy.md).
