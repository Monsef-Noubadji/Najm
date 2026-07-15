# Runtime API

Import public runtime APIs from `@monsef-nbj/najm/core`.

## Reactivity and ownership

- `signal(value)` creates writable state; read and write through `.value`.
- `computed(fn)` creates a read-only derived signal.
- `effect(fn)` reruns when tracked reads change; return or register cleanup work.
- `batch(fn)` defers dependent work until grouped writes finish; `untrack(fn)` suppresses dependency capture.
- `onCleanup(fn)`, `createRoot(fn)`, `currentOwner`, and `withEffectObserver` control or inspect ownership.
- `isSignal(value)` and `get(value)` support generic reactive consumers.

## Application state

`defineStore` creates state with getters and mutators. `createContext`, `provide`, and `inject` pass dependencies through component ownership without globals.

## Components and lifecycle

`instantiate` creates a component instance and `mountComponent` mounts one. `onMounted`, `onUpdated`, and `onDestroyed` register lifecycle work. `currentInstance` and `runWithInstance` are advanced integration APIs.

## DOM and hydration

Generated code uses `bindText`, `bindAttr`, `setAttr`, `bindValue`, `bindChecked`, and `listen`. `claim`, `eachBlock`, and `hoistTemplate` adopt server nodes without recreating them. `hydrateIslands` discovers island payloads and applies their load trigger.

## SSR and escaping

`beginRender` and `endRender` scope a request. `renderToHtml`, `renderComponent`, and `renderIsland` produce escaped output; `attr` and `registerStyle` support generated renderers. Use `toDisplay`, `escapeHtml`, and `escapeAttr` when constructing integrations.

## Recovery and diagnostics

`withErrorBoundary` associates an error handler with owned work. `enableTimeTravel`, `enableGraphInspector`, `snapshot`, and `enableFlushTiming` expose development diagnostics; do not enable them indiscriminately in production.
