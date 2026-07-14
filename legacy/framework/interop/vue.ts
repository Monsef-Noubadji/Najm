/**
 * Vue meta-island adapter — Beta Phase 3
 * =================================================================
 * Same shape as the React adapter: a Vue component becomes a Mono
 * functional component, and a Vue micro-app lives inside a Mono island.
 *
 *   SSR      → createSSRApp + vue/server-renderer renderToString.
 *              THIS call is why Mono's whole SSR pipeline went async in
 *              Beta: Vue renders asynchronously, and a universal host
 *              adopts its guests' constraints rather than forking them.
 *   hydrate  → createSSRApp(...).mount(island) — Vue hydrates the
 *              server markup in place.
 *   destroy  → app.unmount() via Mono's onDestroyed.
 */
import { onDestroyed } from '../runtime/lifecycle';
import type { ComponentView, FunctionalComponent } from '../runtime/mount';
import type { App, Component } from 'vue';

export function defineVueIsland(component: Component): FunctionalComponent {
  return (props: Record<string, unknown> = {}): ComponentView => {
    let app: App | null = null;

    onDestroyed(() => app?.unmount());

    return {
      async ssr() {
        const { createSSRApp } = await import('vue');
        const { renderToString } = await import('vue/server-renderer');
        return await renderToString(createSSRApp(component, props));
      },

      async hydrate(root: Element) {
        const { createSSRApp } = await import('vue');
        app = createSSRApp(component, props);
        app.mount(root);
      },
    };
  };
}
