/**
 * Island bootstrap — Beta
 * =================================================================
 * Still the only script a Najm page ever inlines, and still only when
 * islands exist. Beta teaches it the functional component contract:
 *
 *   module.default is a function  → mountComponent: lifecycle instance,
 *     root ownership scope, onMounted/onUpdated/onDestroyed wiring.
 *     This path serves compiled .najm components AND React/Vue
 *     meta-island adapters identically.
 *   module.hydrate exists         → legacy v0.1 SFC path (no lifecycle).
 *
 * The mounted handle is parked on the island element (__najmIsland) so
 * devtools, tests, and future client routers can unmount islands
 * programmatically — unmount() disposes every owned effect and fires
 * onDestroyed.
 */
import { mountComponent } from './mount';
import type { FunctionalComponent, MountedComponent } from './mount';

interface LegacyIslandModule {
  hydrate(root: Element, props?: Record<string, unknown>): void;
}

declare global {
  interface Element {
    __najmIsland?: MountedComponent;
  }
}

/**
 * Hydrate one island element: dynamic-import its module and mount it
 * against the existing (server-rendered) DOM. Shared by both the eager
 * (`client:load`) and lazy (`client:visible`) paths below — the only
 * difference between them is WHEN this runs, never HOW.
 */
async function hydrateOne(el: Element, load: () => Promise<unknown>): Promise<void> {
  const src = el.getAttribute('data-src');
  try {
    const props = JSON.parse(el.getAttribute('data-props') || '{}');
    const mod: any = await load();
    const comp = mod?.default ?? mod;

    if (typeof comp === 'function') {
      // Beta functional component (or React/Vue meta-island adapter)
      el.__najmIsland = await mountComponent(comp as FunctionalComponent, el, props);
    } else if (comp && typeof comp.hydrate === 'function') {
      // Legacy v0.1 SFC module
      (comp as LegacyIslandModule).hydrate(el, props);
    } else {
      throw new Error('module has neither a default component nor hydrate()');
    }
    el.setAttribute('data-hydrated', ''); // observable "island is live" marker
  } catch (err) {
    console.error(`[najm] failed to hydrate island ${src}`, err);
  }
}

export async function hydrateIslands(
  loaders: Record<string, () => Promise<unknown>>
): Promise<void> {
  const islands = document.querySelectorAll('najm-island');

  // client:load islands (no data-hydrate marker, or an unrecognized one)
  // hydrate exactly as they always have: immediately, all in parallel.
  // This path is UNCHANGED from the pre-partial-hydration mechanism.
  const eager: Element[] = [];
  // client:visible islands defer hydration until they scroll into the
  // viewport — this is the new RFC-0007 partial-hydration path.
  const lazy: Element[] = [];

  for (const el of islands) {
    if (el.getAttribute('data-hydrate') === 'visible') lazy.push(el);
    else eager.push(el);
  }

  await Promise.all(
    eager.map((el) => {
      const src = el.getAttribute('data-src');
      const load = src ? loaders[src] : undefined;
      return load ? hydrateOne(el, load) : undefined;
    })
  );

  observeLazyIslands(lazy, loaders);
}

/**
 * Attach one IntersectionObserver per lazy island, triggering hydration
 * the first (and only) time it intersects the viewport. rootMargin is
 * '200px' rather than '0px' so the dynamic import + hydration work starts
 * slightly BEFORE the island is actually scrolled to — a plain viewport
 * boundary would mean the user visibly waits on the network/JS-eval cost
 * right as the element arrives on screen; the margin turns that into a
 * head start that (on typical scroll speeds) finishes before the element
 * is on screen at all. Each observer disconnects itself immediately after
 * its one trigger — an island only ever needs to hydrate once, and an
 * IntersectionObserver left attached after that would just keep firing
 * (and holding a DOM reference) for no benefit.
 */
function observeLazyIslands(
  elements: Element[],
  loaders: Record<string, () => Promise<unknown>>
): void {
  if (!elements.length) return;

  if (typeof IntersectionObserver === 'undefined') {
    // No IO support (or a non-browser test environment): fail open and
    // hydrate immediately rather than never hydrating at all.
    for (const el of elements) {
      const src = el.getAttribute('data-src');
      const load = src ? loaders[src] : undefined;
      if (load) void hydrateOne(el, load);
    }
    return;
  }

  for (const el of elements) {
    const src = el.getAttribute('data-src');
    const load = src ? loaders[src] : undefined;
    if (!load) continue;

    // `<najm-island>` is rendered `display:contents` (renderIsland(), so
    // the wrapper never affects layout of the component's own markup).
    // That means the wrapper itself generates no box — its
    // getBoundingClientRect() is always {0,0,0,0} — so an
    // IntersectionObserver watching the wrapper directly never reliably
    // reports it as intersecting. Observe its first rendered element
    // child instead (the actual island content, which DOES have a box);
    // fall back to the wrapper only in the pathological case of an
    // island with no element children at all.
    const target = el.firstElementChild ?? el;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect(); // one-shot: hydrate once, then stop watching
          void hydrateOne(el, load);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(target);
  }
}
