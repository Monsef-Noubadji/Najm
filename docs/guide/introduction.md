# Introduction

Najm is a compiler-first reactive web framework for teams that want server-rendered HTML, fine-grained updates, and explicit control over browser JavaScript. It is best suited to content-heavy or server-oriented applications where most of a page is static and a few regions are interactive.

## The engineering model

The `.najm` compiler turns templates into two coordinated programs: an SSR string builder and a browser claim walk. Signals connect directly to generated bindings, so updates do not diff a virtual DOM. Static components send no framework JavaScript; interactive components become independently hydrated islands.

## Package roles

- `@monsef-nbj/najm` provides signals, components, SSR, hydration, stores, context, lifecycle, and boundaries.
- `@monsef-nbj/najm-compiler` compiles `.najm` files and supplies the Vite plugin.
- `@monsef-nbj/najm-router` resolves file routes, layouts, parameters, and middleware.
- `@monsef-nbj/najm-server` exposes development, build, and preview tooling entry modules.

Najm requires Node.js 20 or newer. Version `1.0.0` is the stable compatibility baseline; read [Release status](./release-status) before adopting it for a critical system.

## Next step

Build a minimal application in [Getting started](./getting-started), then use [Project structure](./project-structure) as the map for a production codebase.
