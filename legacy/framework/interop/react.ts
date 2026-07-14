/**
 * React meta-island adapter — Beta Phase 3
 * =================================================================
 * Multi-framework orchestration without a "bridge layer": a React
 * component is wrapped into a function that satisfies Mono's component
 * ABI — `(props) => { ssr, hydrate }` — and from that moment the rest
 * of the framework treats it as a native citizen:
 *
 *   SSR      → react-dom/server renderToString inside Mono's island
 *              wrapper; React's HTML rides Mono's zero-JS page.
 *   hydrate  → react-dom/client hydrateRoot against the island element;
 *              React adopts its own markup, Mono adopts everything else.
 *   destroy  → the adapter registers Mono's onDestroyed during setup,
 *              so unmounting the island unmounts the React root. Meta-
 *              islands don't bypass the lifecycle; they enroll in it.
 *
 * React is imported DYNAMICALLY inside ssr()/hydrate(): the server
 * never loads react-dom/client, the browser never loads
 * react-dom/server, and pages without React islands load neither.
 */
import { onDestroyed } from '../runtime/lifecycle';
import type { ComponentView, FunctionalComponent } from '../runtime/mount';
import type { Root } from 'react-dom/client';
import type { ComponentType } from 'react';

export function defineReactIsland<P extends Record<string, unknown>>(
  Component: ComponentType<P>
): FunctionalComponent {
  return (props: Record<string, unknown> = {}): ComponentView => {
    let reactRoot: Root | null = null;

    // Registered against whichever Mono instance is being set up —
    // exactly like a native component would.
    onDestroyed(() => reactRoot?.unmount());

    return {
      async ssr() {
        const [{ createElement }, { renderToString }] = await Promise.all([
          import('react'),
          import('react-dom/server'),
        ]);
        return renderToString(createElement(Component, props as P));
      },

      async hydrate(root: Element) {
        const [{ createElement }, { hydrateRoot }] = await Promise.all([
          import('react'),
          import('react-dom/client'),
        ]);
        reactRoot = hydrateRoot(root, createElement(Component, props as P));
      },
    };
  };
}
