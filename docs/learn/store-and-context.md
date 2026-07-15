# Store and context

Use stores for named shared state with explicit getters and mutators. Use context for dependency injection through a component tree.

```ts
import { createContext, defineStore, inject, provide } from '@monsef-nbj/najm/core';

const Session = createContext<{ userId: string }>('session');
provide(Session, { userId: '42' });
const session = inject(Session);
```

Create providers inside the request or component ownership boundary. Module-level mutable stores can leak state between SSR requests. Mutators should be the only write path for domain state; getters should remain pure.
