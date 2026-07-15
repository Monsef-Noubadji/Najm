# Najm

**A compiler-first reactive framework that ships JavaScript only where user
interaction requires it.** No Virtual DOM. Zero JS by default. Signals,
islands, file-based SSR routing — compiled, not reconciled.

> نجم — "star" in Arabic. Beta (`0.3.0-beta.0`): install from npm with
> `npm install @monsef-nbj/najm@beta`; API stability tiers are defined in
> [RFC-0018](docs/rfcs/RFC-0018-public-api-stability.md).

```ts
// Counter.najm — a functional component: the closure IS the instance
import { signal, onMounted } from "@monsef-nbj/najm/core";

export default function Counter(props = {}) {
  const count = signal(props.start ?? 0);
  onMounted(() => console.log("live"));

  return {
    template: `<button (click)={count.value++}>Count: {count.value}</button>`,
  };
}
```

The compiler statically extracts that template and replaces it with two
generated closures — an SSR string builder and a hydration claim-walk —
that capture your signals lexically. Templates stay statically analyzable
(`${…}` is a compile error); hydration adopts server DOM node-by-node,
it never re-renders to compare.

## What you get

- **Fine-grained signals** — `signal` / `computed` / `effect` with an
  ownership tree (Solid-style Owner/Listener split); updates touch exactly
  the DOM nodes that display the changed value.
- **Zero JS by default** — a page with no interactive component ships
  **0 bytes** of framework JavaScript (a hard-gated benchmark, not a
  slogan). Interactivity is opt-in per component: `client:load` or
  `client:visible` (IntersectionObserver-deferred) islands.
- **File-based SSR routing** — `src/pages/**` maps to routes, with nested
  `layout.najm` composition, `middleware.ts` (redirect/reject before
  render), dynamic `[param]` and catch-all `[...slug]` segments.
- **Two-way binding** — `bind:value` / `bind:checked`, compiled to one
  effect plus one listener.
- **Real semantic analysis** — a typo'd identifier in a template is a
  compile error naming the identifier, powered by the same scope resolution
  the language server uses.
- **Production build** — `najm build` pre-renders static routes to HTML,
  bundles each island as its own hashed chunk sharing one runtime
  (~7.7 kB gzipped), and emits a manifest a thin production server
  (`najm preview`) serves — request-time SSR (with middleware) only where
  a route genuinely needs it.
- **Error boundaries** — `withErrorBoundary()` isolates a crashing
  component's SSR to fallback HTML; hydration failures leave server HTML
  intact per island.
- **Store & context** — Proxy-based deep-reactive global store with
  time-travel debugging; `provide`/`inject` DI on the ownership tree.
- **Plugin API** — `transformIR(nodes, scope)` hooks over the compiler's
  real IR with trustworthy dependency metadata (a Markdown plugin ships as
  the proof).
- **Tooling** — `najm` CLI (`dev`/`build`/`preview`/`doctor`/`lint`/
  `create-najm-app`), an LSP server (diagnostics, go-to-definition,
  completion) reusing the real compiler with zero forked grammar, a VS Code
  extension, and opt-in DevTools instrumentation (signal graph, flush
  timing, store time-travel).

## Quick start (from source — npm packages not published yet)

```bash
git clone <this-repo> najm && cd najm
npm install
npm run cli -- doctor        # environment checklist
npm run dev                  # http://localhost:3000
npm test                     # 198 assertions across 20 suites
npm run build && npm run serve   # production build + thin server :4000
```

Scaffold a new app from the built-in template:

```bash
npm run cli -- create-najm-app my-app
```

## Documentation

- **User guide:** [docs/guide/](docs/guide/README.md) — getting started,
  components & reactivity, routing & SSR, and the CLI reference.
- **Architecture record:** [docs/rfcs/](docs/rfcs/README.md) — twenty RFCs
  covering every subsystem, each with a Verification section citing the
  real tests that prove it. Start with
  [RFC-0001 (Vision & Philosophy)](docs/rfcs/RFC-0001-vision-and-philosophy.md).

## Repository layout

```text
compiler/         parser → semantic analysis → IR → codegen (SSR + hydration backends)
runtime/          signals, scheduler, lifecycle, hydration, store, context, devtools
router/           file-based route resolution, layouts, middleware
server/           dev server (Vite middleware), production build, thin prod server
cli/              the najm binary: dev/build/preview/doctor/lint/create-najm-app
language-server/  LSP over the real compiler (diagnostics, definition, completion)
vscode/           VS Code extension (grammar + LSP client)
benchmarks/       self-relative regression benchmarks (bundle size hard-gated in CI)
packages/         npm distribution manifests (najm, najm-compiler, najm-router, najm-server)
tests/            198 assertions, no test framework — node:assert + tsx
docs/             user guide + the RFC architecture record
legacy/           pre-pivot Mono-era prototypes, kept verbatim as history
```

## Numbers (measured, not aspirational)

| Claim | Measurement |
| --- | --- |
| Zero-island page JS | **0 bytes** (hard-gated regression test) |
| Shared runtime | ~23.1 kB raw / **~7.7 kB gzipped**, paid once per island-bearing page |
| Real island (signals + computed + each-block + bindings) | **~0.9 kB gzipped** marginal |
| Hydration cost | scales with dynamic bindings, not template size (claim-call-count asserted at codegen level; wall-clock benchmarked in a real browser) |

## License

[MIT](LICENSE) © 2026 Monsef Noubadji and Najm contributors.
