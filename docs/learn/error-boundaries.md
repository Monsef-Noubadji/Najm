# Error boundaries

`withErrorBoundary` contains errors raised during setup, rendering, event handling, and reactive work. The boundary receives the error and phase so applications can log useful diagnostics and render a controlled fallback.

Boundaries are not a replacement for request-level HTTP error handling. Place them around independently recoverable interface regions, avoid exposing stack traces to users, and let infrastructure failures reach server observability. Test setup, render, event, and effect failures separately.

## Wrap a component

Create a plain TypeScript wrapper so the boundary is defined once at module scope:

```ts
import { withErrorBoundary } from '@monsef-nbj/najm/core';
import AccountPanel from './AccountPanel.najm';

export default withErrorBoundary(AccountPanel, (_error, phase) =>
  `<section role="alert" data-phase="${phase}">Account details are temporarily unavailable.</section>`,
);
```

Import the wrapper into a functional `.najm` page and render it like any other component:

```najm
import SafeAccountPanel from '../components/SafeAccountPanel.ts';

export default function AccountPage() {
  return { template: `<main><SafeAccountPanel /></main>` };
}
```

The fallback is trusted application HTML. Escape or sanitize any dynamic values before interpolating them into it.
