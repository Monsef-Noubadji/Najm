# Store and context

Use stores for named shared state with explicit getters and mutators. Use context for dependency injection through a component tree.

```ts
import { createContext, defineStore, inject, provide } from '@monsef-nbj/najm/core';

const Session = createContext<{ userId: string }>('session');
provide(Session, { userId: '42' });
const session = inject(Session);
```

Create providers inside the request or component ownership boundary. Module-level mutable stores can leak state between SSR requests. Mutators should be the only write path for domain state; getters should remain pure.

## Store definition

`defineStore` receives one definition object and returns a singleton accessor. Actions receive state as their first argument and are exposed under `$actions`.

```ts
import { defineStore } from '@monsef-nbj/najm/core';

const useCounter = defineStore({
  state: () => ({ count: 0 }),
  actions: {
    increment(state) {
      state.count += 1;
    },
  },
  getters: {
    doubled: (state) => state.count * 2,
  },
});

const counter = useCounter();
counter.$actions.increment();
console.log(counter.count, counter.$getters.doubled);
```

## Request-local context

```ts
import { createContext, createRoot, inject, provide } from '@monsef-nbj/najm/core';

const Session = createContext<{ userId: string }>('session');

createRoot(() => {
  provide(Session, { userId: '42' });
  const session = inject(Session);
  console.log(session.userId);
});
```
