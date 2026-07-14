# Components

Every code sample on this page was run through the real Najm compiler
(parse, semantic analysis, and full SSR + hydration codegen) before being
included.

## The component model

A Najm component is a **plain function** in a `.najm` file. The function
body runs **once per instance** — on the server to produce HTML, and again
on the client at hydration if the component is an island. Everything the
template needs is ordinary lexical scope: the closure *is* the instance.

```js
export default function Hello(props = {}) {
  const name = props.name ?? "world";
  return {
    template: `<p>Hello, {name}!</p>`,
  };
}
```

The returned object has two keys:

- `template` — a backtick string the compiler **statically extracts** and
  replaces with two generated closures: an SSR string builder and a
  hydration claim-walk that adopts the server DOM node by node. Because the
  template must stay statically analyzable, JavaScript `${…}` interpolation
  inside it is a compile error — use Najm's `{expr}` syntax instead.
- `style` *(optional)* — CSS injected once per component type.

Templates are **semantically checked at compile time**: referencing an
identifier that doesn't exist in the component's scope is a compile error
naming that identifier (`najm lint` and the language server use the same
analysis).

## Signals and reactivity

Import reactivity primitives from `najm/core`:

```js
import { signal } from "najm/core";

export default function Counter(props = {}) {
  const count = signal(props.initial ?? 0);
  const increment = () => count.value++;

  return {
    template: `
      <button (click)={increment()}>Count: {count}</button>
    `,
    style: `
      button { padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; }
    `,
  };
}
```

- `signal(initial)` creates a reactive value. Read/write it in JavaScript
  via `.value`; read it without subscribing via `.peek()`.
- In templates, `{count}` **auto-unwraps** the signal — `{count}` and
  `{count.value}` render the same thing.
- Updates are fine-grained: writing `count.value` re-runs only the effects
  (and updates only the DOM nodes) that read it.

### `computed`, `effect`, `batch`, `untrack`, `onCleanup`

```js
import { signal, computed, effect, batch, untrack, onCleanup } from "najm/core";

export default function Thermometer(props = {}) {
  const celsius = signal(21);
  const fahrenheit = computed(() => celsius.value * 9 / 5 + 32);

  effect(() => {
    console.log(`temperature is now ${celsius.value}°C`);
    onCleanup(() => console.log("re-running or disposing"));
  });

  const reset = () => {
    // batch(): both writes flush as one update wave.
    batch(() => {
      celsius.value = 21;
    });
    // untrack(): read without subscribing the surrounding effect.
    console.log("was", untrack(() => fahrenheit.value));
  };

  return {
    template: `
      <div>
        <p>{celsius}°C is {fahrenheit}°F</p>
        <button (click)={celsius.value++}>warmer</button>
        <button (click)={reset()}>reset</button>
      </div>
    `,
  };
}
```

- `computed(fn)` is a memoized derived value — recomputed only when a
  dependency changes.
- `effect(fn)` runs immediately and re-runs when any signal it read
  changes. Effects created during component setup are owned by the
  component and disposed with it.
- `onCleanup(fn)` registers teardown that runs before the enclosing effect
  re-runs or is disposed.

## Template syntax

### Text interpolation — `{expr}`

Any JavaScript expression in braces renders as **escaped** text and updates
reactively; signals auto-unwrap.

```html
<p>Hello, {name}!</p>
<p>{celsius}°C is {fahrenheit}°F</p>
```

### Attributes — static, dynamic, and boolean

```js
import { signal } from "najm/core";

export default function StatusBadge(props = {}) {
  const online = signal(false);

  return {
    template: `
      <div>
        <span id="status" class={online.value ? "on" : "off"} title="connection status">
          {online.value ? "online" : "offline"}
        </span>
        <button (click)={online.value = !online.value}>toggle</button>
        <input type="text" disabled />
      </div>
    `,
  };
}
```

- `attr="value"` — static attribute.
- `attr={expr}` — reactive attribute, updates when its dependencies change.
- A bare attribute (`disabled`) is boolean-true, as in HTML.

### Event handlers — `(event)={statement}` and `on:event={handler}`

Two forms:

- **`(click)={statement}`** — Angular-style: the braces contain a
  *statement* executed when the event fires, with the DOM event available
  as `$event`. `(click)={count.value++}` does what it looks like it does.
- **`on:click={handler}`** — the braces contain a *handler reference*; the
  function is called with the DOM event.

```js
import { signal } from "najm/core";

export default function SearchForm(props = {}) {
  const query = signal("");
  const submitted = signal("");

  // A handler REFERENCE for on:click — receives the DOM event.
  const clear = (event) => {
    query.value = "";
    submitted.value = "";
  };

  return {
    template: `
      <form (submit)={$event.preventDefault(); submitted.value = query.value}>
        <input bind:value={query} placeholder="Search…" />
        <button type="submit">Go</button>
        <button type="button" on:click={clear}>Clear</button>
        <p>Last search: {submitted}</p>
      </form>
    `,
  };
}
```

Event listeners are client-only — they are stripped from server output and
attached during hydration, so they only work inside islands (see below).

### Two-way binding — `bind:value` and `bind:checked`

Pass the **signal itself** (not `.value`). Each binding compiles to exactly
one effect (signal → DOM) plus one listener (DOM → signal).

```js
import { signal, computed } from "najm/core";

export default function Settings(props = {}) {
  const username = signal("ada");
  const newsletter = signal(false);
  const summary = computed(() =>
    `${username.value} — newsletter ${newsletter.value ? "on" : "off"}`);

  return {
    template: `
      <fieldset>
        <label>Username <input bind:value={username} /></label>
        <label><input type="checkbox" bind:checked={newsletter} /> Subscribe</label>
        <p>{summary}</p>
      </fieldset>
    `,
  };
}
```

### Lists — `{#each}`

Two forms: with and without an index variable.

```js
import { signal } from "najm/core";

export default function Leaderboard(props = {}) {
  const tags = ["compiler-first", "zero-js", "islands"];
  const players = signal([
    { name: "Ada", score: 42 },
    { name: "Grace", score: 38 },
  ]);

  return {
    template: `
      <div>
        <ul>
          {#each tags as tag}
            <li>{tag}</li>
          {/each}
        </ul>
        <ol>
          {#each players as player, i}
            <li>#{i + 1} {player.name} — {player.score} points</li>
          {/each}
        </ol>
      </div>
    `,
  };
}
```

The list expression can be a plain array or a signal of an array; replacing
the signal's array re-renders the block.

### Raw HTML — `{@html expr}` (server-only, for layouts)

`{@html expr}` interpolates a string as **unescaped** HTML. It exists for
one purpose: layout composition, where a layout embeds a page's
already-rendered, framework-produced HTML. It is deliberately named after
Svelte's "dangerous one" — never feed it user content.

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

### Child components and islands

Import a component and use it as a capitalized, **self-closing** tag
(components must be self-closing in the current version; slots are on the
roadmap). Props are passed as attributes; `{expr}` props may be any
serializable value.

```js
import Counter from "./Counter.najm";

export default function Dashboard(props = {}) {
  return {
    template: `
      <main>
        <h1>Dashboard</h1>

        <Counter initial={10} />

        <Counter client:load initial={0} />

        <Counter client:visible initial={100} />
      </main>
    `,
  };
}
```

- **No directive** — a zero-JS static include: the child renders to HTML on
  the server and ships no JavaScript.
- **`client:load`** — an island that hydrates as soon as the page's
  bootstrap script runs.
- **`client:visible`** — an island whose JavaScript is not even fetched
  until it scrolls near the viewport (see
  [Routing & SSR](routing-and-ssr.md#islands) for the exact behavior).

Island props cross the server/client boundary, so they must be
serializable.

## Lifecycle hooks

Hooks attach to the component instance during setup:

```js
import { signal, computed, onMounted, onUpdated, onDestroyed } from "najm/core";

export default function Ticker(props = {}) {
  const ticks = signal(0);
  const label = computed(() => `${ticks.value} tick(s)`);

  onMounted(() => console.log("Ticker is live in the browser"));
  onUpdated(() => console.log("DOM settled after an update —", ticks.peek()));
  onDestroyed(() => console.log("Ticker removed, effects disposed"));

  return {
    template: `<button (click)={ticks.value++}>{label}</button>`,
  };
}
```

- `onMounted` — client-only: fires when the island is hydrated and
  interactive.
- `onUpdated` — fires after the reactivity graph settles following an
  update.
- `onDestroyed` — fires when the instance is torn down; all its effects are
  disposed.

## Error boundaries — `withErrorBoundary`

`withErrorBoundary(Component, onError)` wraps a component so that a crash
during its server render produces **fallback HTML instead of a 500 for the
whole page**, and a hydration failure leaves the island's server HTML
intact. A component that throws:

```js
export default function Crasher(props = {}) {
  if (props.bad) {
    throw new Error(`Crasher: refusing to render with bad="${props.bad}"`);
  }
  return {
    template: `<div class="crasher-ok">Rendered fine — no bad prop.</div>`,
  };
}
```

Wrap it in a plain `.ts` module (this is this repo's real, working
`src/components/SafeCrasher.ts` pattern — wrapping at module scope keeps
the page itself free of any boundary wiring):

```ts
import { withErrorBoundary } from 'najm/core';
import Crasher from './Crasher.najm';

export default withErrorBoundary(Crasher, (error, phase) => {
  console.error('[najm] error boundary caught', phase, error);
  return `<div class="crasher-fallback" data-phase="${phase}">Something went wrong rendering this component — showing a fallback instead.</div>`;
});
```

Then use `<SafeCrasher />` like any other component. `phase` tells you
whether the failure happened during `ssr` or hydration. A live demo page
ships in this repo at `src/pages/error-boundary-demo.najm`.

## Global state — `defineStore`

`defineStore` creates a Pinia-style singleton store on Najm's own
reactivity: deeply reactive state (Proxy-based — new properties and nested
objects are reactive too), bound actions, and memoized getters. Define it
once in a shared module:

```ts
import { defineStore } from "najm/core";

export const useCartStore = defineStore({
  state: () => ({
    items: [] as { name: string; qty: number }[],
  }),
  actions: {
    add(state, name: string) {
      state.items.push({ name, qty: 1 });
    },
    clear(state) {
      state.items = [];
    },
  },
  getters: {
    count: (state) => state.items.length,
  },
});
```

Use it from any component — every consumer shares the same instance:

```js
import { useCartStore } from "./cart-store";

export default function CartWidget(props = {}) {
  const cart = useCartStore();
  const addSocks = () => cart.$actions.add("socks");

  return {
    template: `
      <div>
        <p>{cart.$getters.count} item(s) in cart</p>
        <ul>
          {#each cart.items as item}
            <li>{item.name} × {item.qty}</li>
          {/each}
        </ul>
        <button (click)={addSocks()}>Add socks</button>
        <button (click)={cart.$actions.clear()}>Empty cart</button>
      </div>
    `,
  };
}
```

- State is read directly (`cart.items`); reads are tracked per property, so
  writing `cart.items` notifies only effects that read `cart.items`.
- `cart.$actions.name(...)` — actions with `state` pre-bound.
- `cart.$getters.name` — memoized derived values.
- `cart.$subscribe(fn)` — observe every committed action;
  `cart.$replaceState(next)` swaps the whole tree (this is what powers the
  opt-in time-travel devtools, `enableTimeTravel()` from `najm/core`).

## Context — `createContext` / `provide` / `inject`

Dependency injection down the component tree, built on the same ownership
tree that owns your effects. Create a typed context handle in a shared
module:

```ts
import { createContext } from "najm/core";

export const ThemeContext = createContext<"light" | "dark">("theme", "light");
```

`provide()` publishes a value during a component's setup; every descendant
can `inject()` it:

```js
import { provide } from "najm/core";
import { ThemeContext } from "./theme";
import ThemedButton from "./ThemedButton.najm";

export default function App(props = {}) {
  // Publish for every descendant — must run during setup,
  // before the view object is returned.
  provide(ThemeContext, "dark");

  return {
    template: `
      <main>
        <ThemedButton client:load />
      </main>
    `,
  };
}
```

```js
import { inject } from "najm/core";
import { ThemeContext } from "./theme";

export default function ThemedButton(props = {}) {
  // Reads the nearest ancestor provide(); falls back to the
  // context's default ("light") if no provider exists.
  const theme = inject(ThemeContext);

  return {
    template: `<button class={theme}>I am {theme}-themed</button>`,
  };
}
```

`inject()` walks up to the nearest provider, falls back to the context's
default value, and **throws** if neither exists — a missing provider is a
programming error, not a silent `undefined`.

## Legacy note: `<script>/<template>/<style>` SFCs

`.najm` files also compile in a legacy single-file-component style with
explicit blocks. It still works (this repo's `src/pages/about.najm` uses
it) and both styles hydrate identically, so codebases can migrate file by
file — but **the functional style above is the default to write new code
in**.

```html
<script>
  const facts = [
    "Every page is server-rendered HTML first.",
    "The route came from the filename.",
  ];
</script>

<template>
  <main>
    <h1>About</h1>
    <ul>
      {#each facts as fact}
        <li>{fact}</li>
      {/each}
    </ul>
  </main>
</template>

<style>
  main { max-width: 42rem; margin: 0 auto; }
</style>
```

---

Next: [Routing & SSR](routing-and-ssr.md) — where components become pages,
and islands become the only JavaScript on them.
