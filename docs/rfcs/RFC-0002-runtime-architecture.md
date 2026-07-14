# RFC-0002: Runtime Architecture

- **Status:** Implemented
- **Depends on:** RFC-0001
- **Supersedes:** the Beta "meta-island" design where React/Vue adapters
  implemented Najm's internal `(props) => { ssr, hydrate }` ABI directly
  (archived at `legacy/framework/interop/`)
- **Formalizes:** `runtime/signals.ts` (ownership tree), `runtime/lifecycle.ts`
  (lifecycle hooks), `runtime/mount.ts` (mount contract), `runtime/context.ts`
  (context system) — all implemented and tested — plus the boundary gate
  in `tests/test-runtime-boundary.ts` (all verified — see Verification)

## Summary

`najm`'s runtime is: reactive primitives (RFC-0004), an ownership tree
for lifecycle management, a component instantiation/mount contract, and a
hydration engine (RFC-0007). Everything else — routing, DevTools, other
frameworks — sits outside this package and depends on it, never the other
way around. Cross-framework interop happens at the Web Component boundary,
not inside the runtime.

## Motivation

The runtime currently implemented (`runtime/`) already has the
right shape for the reactive core, lifecycle, and mount contract — that
work survives this RFC essentially as-is. What needs formal specification
is the boundary the review flagged: how far the runtime's responsibility
extends, and specifically that it does not extend into hosting another
framework's reconciler.

## Design

### Package boundary

```text
najm            reactivity, lifecycle, mount contract, hydration engine
   ▲
   │ depends on
   │
najm-compiler         .najm → JS (RFC-0003), imports najm's exports
najm-router            file-based routing (RFC-0008), imports najm
najm-devtools-bridge   imports najm, zero DOM deps (RFC-0010)
```

No package above imports another peer package. `najm` imports
nothing outside the JS/DOM standard library.

### The component contract (unchanged from Beta, now the formal spec)

```ts
type FunctionalComponent = (props?: Record<string, unknown>) => ComponentView;

interface ComponentView {
  ssr(): string | Promise<string>;
  hydrate(root: Element): void | Promise<void>;
}
```

A component function's body is its setup phase, run once per instance —
once on the server producing `ssr()`'s closure, once on the client at
hydration producing `hydrate()`'s closure. The compiler (RFC-0003)
statically extracts the authored `template` and splices in generated
closures at the same lexical position, so generated bindings capture the
component's own signals directly — no instance proxy, no `this`.

### Ownership tree (implemented, formalizing existing behavior)

Every effect, computed, and nested component scope belongs to the scope
that created it (`Owner`, distinct from `Listener`, which answers "who
re-runs on my reads" — see RFC-0004 for the full split). `createRoot()`
gives a mounted component instance ONE disposal handle for every effect its
view will ever create, including effects created later by list rows or
nested reactive regions. `unmount()` is one `dispose()` call.

This is also the substrate for dependency injection: `provide()`/`inject()`
(already implemented in `runtime/context.ts`) walk this same
ownership tree upward from the current scope. This is deliberately the
Angular idea the review says to keep — hierarchical, scope-based DI — built
on the reactivity graph Najm already has, not a separate injector.

### Lifecycle hooks (implemented, formalizing existing behavior)

`onMounted` / `onUpdated` / `onDestroyed` are defined against the DOM and
the reactivity graph, not a render cycle Najm doesn't have:

- `onMounted` fires once, client-side only, after hydration completes.
  Never fires during SSR — there is no DOM on the server.
- `onUpdated` fires when any effect owned by the instance re-runs,
  coalesced per microtask via an effect observer threaded through the
  ownership tree.
- `onDestroyed` fires after `unmount()` disposes every owned effect.

### Cross-framework interop: Web Components, not runtime embedding

Najm does **not** ship a `najm/interop/react` or `.../vue` module that
lets a React or Vue component satisfy `ComponentView` directly. That
pattern was implemented in Beta, worked, and is exactly what the review
flags as unnecessary runtime complexity: it means `najm`'s hydration
pipeline has to reason about `hydrateRoot`/`createSSRApp` lifecycles that
aren't its own.

Instead:

```text
Najm Component  →  compiles to a Custom Element (RFC-0003 emits this
                    as an opt-in target, not the default)
                         ↓
              a standard Web Component, framework-agnostic
                         ↓
        React wraps it via a ref + imperative attribute/property sync
        Vue wraps it via its native custom-element interop
        Angular wraps it via CUSTOM_ELEMENTS_SCHEMA
```

This keeps DOM ownership unambiguous (the custom element owns its subtree;
the host framework never reaches inside it) and means `najm` never
imports or dynamically imports another framework's runtime. Building a
*Najm-side* consumer of a foreign Web Component (e.g., embedding a
React-authored custom element inside a Najm page) needs no special code
at all — it is just a DOM element, static or with attributes bound the
same way any other element's attributes are.

Full custom-element compilation target is specified when RFC-0003's IR is
in place; this RFC only fixes the boundary decision.

## Alternatives considered

- **Keep the Beta meta-island adapters, just document them better.**
  Rejected per the architecture review and the archival decision recorded
  in `legacy/README.md` — the complexity cost (hydration pipeline needing
  to understand foreign lifecycles, dep-optimization traps like the
  `react/jsx-dev-runtime` mid-session re-optimize bug hit during Beta
  verification) wasn't paying for itself relative to the Web Component
  boundary, which needs zero special-casing in `najm`.

## Verification

- `najm` has zero imports of `react`, `vue`, `@angular/*`, or any
  other UI framework (`tests/test-runtime-boundary.ts`): statically scans
  every `.ts` file under `runtime/` for import/require specifiers and
  fails loudly against a list of known UI framework packages (`react`,
  `react-dom`, `vue`, `@vue/runtime-core`, `@vue/runtime-dom`,
  `@angular/core`, `@angular/common`, `svelte`, `solid-js`, `preact`,
  `lit` — see the file for why each is listed). The same suite also
  asserts the other half of the package-boundary line — `runtime/` imports
  nothing outside itself except the JS/DOM standard library, i.e. no
  relative import escapes `runtime/` into `compiler/`, `router/`, or
  `server/`, and no bare specifier is a third-party package. Verified by
  temporarily injecting a `react` import and a `../router/router` import
  into `runtime/` files during implementation and confirming both trip the
  gate (`AssertionError`, non-zero exit), then reverting — the gate is not
  vacuously passing. Runs today as a standalone script via
  `tsx tests/test-runtime-boundary.ts`, wired into `npm test`; formalizes
  as a permanent local/CI check the RFC-0015 stub's role for this specific
  gate ahead of a full testing-strategy RFC. **Done.**
- Ownership-tree disposal: unmounting a component leaves zero live effects
  (already covered by `tests/test-lifecycle.ts`'s unmount test). **Done.**
- Context: `inject()` resolves through nested scopes and shadows correctly
  (already covered by `tests/test-store.ts`'s context tests). **Done.**

## Open questions

- Exact custom-element compilation target (shadow DOM vs. light DOM,
  attribute/property reflection rules) is deferred to when RFC-0003's
  codegen work reaches it — not blocking for RFC-0002's boundary decision.
