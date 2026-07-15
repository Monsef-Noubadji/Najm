# Components

Najm components combine setup logic with a template. The compiler validates identifiers and emits SSR plus hydration code.

## Reactivity

```ts
import { signal, computed, effect, batch, onCleanup } from '@monsef-nbj/najm/core';

const quantity = signal(1);
const total = computed(() => quantity.value * 25);
effect(() => console.log(total.value));
batch(() => { quantity.value += 2; });
onCleanup(() => console.log('disposed'));
```

Read a signal in a template with `{quantity}` and write through `.value`. `computed` derives cached values, `effect` handles external side effects, and `batch` coalesces writes.

## Template bindings

Use `{expression}` for escaped text, `(click)={handler}` for events, and bind directives for form state. Raw HTML bypasses escaping and must only receive trusted or sanitized content.

Lifecycle hooks `onMounted`, `onUpdated`, and `onDestroyed` run within a component instance. Keep browser-only work in mounted hooks so SSR remains deterministic.

## Composition

Components can render child components and repeated blocks. Prefer small ownership boundaries: the signal owner disposes effects and cleanups when its component is destroyed. For shared state, use [stores and context](/learn/store-and-context); for recovery, use [error boundaries](/learn/error-boundaries).
