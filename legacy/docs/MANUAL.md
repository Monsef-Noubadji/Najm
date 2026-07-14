# Mono Beta — Technical Manual

**Version 0.2.0-beta.1** · supersedes the v0.1 SFC architecture (which remains
supported — see [Migration](#migration-sfc--functional)).

---

## 0. What Beta is

v0.1 proved four paradigms compose: signals, two-way binding, file-based SSR,
islands. Beta rebuilds the component model on top of that proof:

1. **Functional instances** — a component is a function; its closure is the
   instance. No SFC blocks, no `this`, no instance proxy object.
2. **Lifecycle hooks** — `onMounted` / `onUpdated` / `onDestroyed`, defined
   against the two things Mono actually has (the DOM and the reactivity
   graph), not against a render cycle Mono deliberately lacks.
3. **Meta-islands** — React components and Vue micro-apps hydrate inside Mono
   islands through one shared component ABI.
4. **Tooling** — VS Code language support (`tooling/vscode-mono/`).
5. **Distribution** — `mono-core` / `mono-compiler` / `mono-server` npm
   blueprints (`packages/`).

---

## 1. The functional instance architecture

### Authoring model

```ts
// Counter.mono — a TypeScript module, not an SFC
import { signal, onMounted } from 'mono/core';

export default function Counter(props = {}) {
  const count = signal(props.start ?? 0);

  onMounted(() => console.log('Counter mounted to DOM'));

  return {
    template: `<button (click)={count.value++}>Count: {count.value}</button>`,
    style: `button { font: inherit; }`,
  };
}
```

The function body **is** the setup phase and runs exactly once per instance —
on the server for HTML, on the client at hydration. Everything the template
references is plain lexical scope.

### The compiled contract (the component ABI)

The compiler rewrites the returned object in place:

```ts
return {
  ssr:     async () => { /* string building over YOUR closure */ },
  hydrate: (__root) => { /* claim walk + bindings over YOUR closure */ },
};
```

So a component is `(props) => ComponentView` where
`ComponentView = { ssr(): Promise<string> | string; hydrate(root): void | Promise<void> }`.
That one signature is the entire framework interface — compiled `.mono`
components, React adapters, and Vue adapters all satisfy it, and
`mountComponent` / `renderToHtml` cannot tell them apart. **The ABI is the
interop layer.**

### Lifecycle semantics (`framework/runtime/lifecycle.ts`)

| Hook | Fires | Never fires |
|---|---|---|
| `onMounted` | once, after the view adopts its DOM and listeners are live | during SSR — mounting is a DOM event and the server has no DOM |
| `onUpdated` | after any effect owned by the instance re-runs; coalesced per microtask (a `batch()` touching ten bindings ⇒ one call) | for the initial hydration pass (instance isn't `mounted` yet) |
| `onDestroyed` | on `unmount()`, after every owned effect is already disposed | — |

Hooks bind to the "current instance" — a module-level stack maintained by
`runWithInstance()`, the same mechanism as Vue's `getCurrentInstance` and
React's dispatcher. Calling a hook outside setup throws.

Two runtime primitives added in Beta make this work (`signals.ts`):

- **Owner/Listener split.** Ownership ("who disposes me") and tracking ("who
  re-runs on my reads") were one variable in v0.1; Beta splits them so
  `createRoot()` can own an instance's every effect — including list rows
  created months of interactions later — without the scope itself ever
  re-running. `unmount()` is one `dispose()` call.
- **Effect observers.** `withEffectObserver(obs, fn)` stamps every computation
  created inside `fn` (inherited down the ownership tree) with a post-run
  callback. That is *literally* what `onUpdated` is: a subscription to the
  graph settling.

### Mounting (`framework/runtime/mount.ts`)

```
mountComponent(comp, islandEl, props)
  ├─ instantiate: new ComponentInstance → runWithInstance(comp(props))
  ├─ createRoot( withEffectObserver(scheduleUpdated, view.hydrate(root)) )
  ├─ instance.markMounted()  → onMounted hooks
  └─ returns { instance, unmount }   // parked on el.__monoIsland
```

---

## 2. The compiler (Beta mode)

`framework/compiler/codegen.ts` dispatches per file:

- source contains `export default function` → **functional compiler**
- source contains `<template>` blocks → **legacy SFC compiler** (v0.1 path,
  now emitting async `ssr()`)

The functional compiler:

1. **Finds the view**: scans `return {` statements for the object literal
   carrying a top-level `` template: `…` `` property (balanced-brace scan,
   string/comment aware). Helpers returning other objects are skipped.
2. **Rejects dynamism that would kill static analysis**: `${…}` inside the
   template is a compile error — Mono interpolates with `{expr}`, which the
   compiler can see, bind, and hydrate. A runtime-interpolated template cannot
   be claim-walked and would silently degrade the framework into a
   runtime-parsed one.
3. **Parses** the extracted template with the same AST parser as v0.1
   (plus the `(event)` attribute form).
4. **Splices** the generated `{ ssr, hydrate }` into the original return
   position, so generated code closes over the author's signals directly.
5. Records component imports (`.mono`, `.ts`, `.tsx` default exports) so
   `client:load` islands know their browser URLs.

### Template syntax deltas

| Binding | Semantics |
|---|---|
| `(click)={count.value++}` | **statement**, executed on event, `$event` in scope (Angular semantics) |
| `on:click={handler}` | handler **reference** (v0.1 form, still supported) |
| `bind:value=` / `bind:checked=` | unchanged two-way bindings |
| `{#each list as item, i}` | unchanged |
| `client:load` | unchanged island directive |

### Async SSR

The whole server pipeline is async in Beta — compiled `ssr()` is `async`,
component includes are `await`ed. Vue's `renderToString` forced the issue;
streaming SSR and server data fetching get the door for free.

---

## 3. Meta-islands (framework interop)

```ts
// src/components/ReactCounter.tsx
import { useState } from 'react';
import { defineReactIsland } from 'mono/interop/react';

function ReactCounter({ start = 0 }) { /* ordinary React */ }
export default defineReactIsland(ReactCounter);
```

```html
<!-- any .mono template -->
<ReactCounter client:load start={10} />
<VueLikes client:load label={"Vue micro-app"} />
```

How the adapters work (`framework/interop/react.ts`, `vue.ts`):

- They return a **Mono functional component** — `(props) => ComponentView` —
  whose `ssr()` calls `renderToString` (react-dom/server or
  vue/server-renderer) and whose `hydrate()` calls `hydrateRoot` /
  `createSSRApp().mount()` against the island element.
- Guest frameworks are imported **dynamically inside** `ssr()`/`hydrate()`:
  the server never loads `react-dom/client`, the browser never loads
  `react-dom/server`, and pages without meta-islands load neither framework.
- Adapters call Mono's `onDestroyed` during setup, so `unmount()` on the
  island tears down the React root / Vue app. Guests enroll in the host
  lifecycle rather than escaping it.

Serialized `data-props` cross the wire exactly as for native islands — which
is why island props must be JSON-serializable regardless of guest framework.

**Operational note (dev):** every guest entry the adapters can import —
including the *server* renderers, which Vite's client import-analysis sees
even though they never execute in the browser — must be in
`optimizeDeps.include`. A late discovery re-optimizes mid-session and splits
React into two copies; that is the infamous "Invalid hook call" and we fixed
it by pre-declaring the full set in `framework/server/dev.ts`.

---

## 4. Tooling — `tooling/vscode-mono/`

TextMate grammar (`source.mono`) that treats `.mono` as TypeScript and layers
Mono scopes inside the `template:`/`style:` backticks; language configuration
(auto-close, comments, folding); file icon via the language `icon`
contribution plus an optional icon theme. Packaging: `vsce package` →
`code --install-extension`. Roadmap in its README: injection grammar for
`.ts`, then a language server reusing `mono-compiler`'s real parser for
diagnostics.

---

## 5. Distribution — `packages/`

Three ESM-only packages, one version line, strict one-way dependencies:

```
mono-server ─▶ mono-compiler ─▶ mono-core   (user runtime code sees only mono-core)
```

Key decisions (full rationale in `packages/README.md`): `mono-core` has zero
runtime deps with React/Vue as *optional* peers; `sideEffects: false`
everywhere with a CI bundle-size gate; `exports` maps sealing internals;
changesets-driven lockstep versioning; `beta` dist-tag; provenance-attested
publishes (`.github/workflows/release.yml`).

---

## Migration: SFC → functional

Both syntaxes compile in the same tree — migrate file by file.

| v0.1 SFC | Beta functional |
|---|---|
| `<script>` block | function body |
| implicit `props` | explicit `props` parameter |
| `<template>` block | `` return { template: `…` } `` |
| `<style>` block | `` style: `…` `` property |
| `on:submit={(e) => …}` | `(submit)={$event…; …}` (or keep `on:`) |
| module exports `ssr/hydrate` | module default-exports the component fn |
| — | `onMounted` / `onUpdated` / `onDestroyed` |

Caveat: a **legacy** `.mono` cannot be imported into a **Beta** file with a
default import (legacy modules have no default export). Migrate leaf-first.

## Known limitations (Beta)

Everything from v0.1 that wasn't addressed (dev-only pipeline, global styles,
keyless each-blocks, no `{#if}`, `client:load` only), plus: single
`return { template }` per component (no conditional views); no slots/children;
islands don't nest; `onUpdated` observes the reactivity graph, so a `computed`
recomputation counts as an update even when the DOM output is unchanged.
