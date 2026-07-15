---
layout: home
title: Najm
titleTemplate: Compiler-first reactive framework

hero:
  name: Najm
  text: Ship HTML first. Hydrate only interaction.
  tagline: A compiler-first reactive framework with signals, SSR, and zero-JavaScript-by-default islands.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Monsef-Noubadji/Najm

features:
  - title: Fine-grained by construction
    details: Signals connect directly to the DOM bindings that consume them. No tree diff and no component-wide rerender.
  - title: HTML is the default
    details: Static pages ship zero framework JavaScript. Interactive components opt into isolated hydration.
  - title: Compiler-enforced correctness
    details: Template identifiers, bindings, and plugin transforms are checked before they reach production.
  - title: Routing built for SSR
    details: File routes, layouts, middleware, static generation, and request-time rendering share one model.
---

<HomeSignal />

## A framework for engineers who want to see the mechanism

Najm compiles `.najm` components into an SSR string builder and a hydration
claim walk. The server emits useful HTML; the browser adopts those nodes and
attaches only the signal bindings and listeners the component needs.

```ts
import { signal } from '@monsef-nbj/najm/core';

export default function Counter() {
  const count = signal(0);
  return {
    template: `<button (click)={count.value++}>Count: {count}</button>`,
  };
}
```

Najm `1.0.0` is stable. Its public stability tiers and compatibility guarantees
are documented in [RFC-0018](/rfcs/RFC-0018-public-api-stability).
