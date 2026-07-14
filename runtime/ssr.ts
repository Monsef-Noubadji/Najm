/**
 * Server rendering support — see docs/rfcs/RFC-0006-ssr-and-rendering.md
 * and docs/rfcs/RFC-0016-security-model.md (request-isolation guarantee)
 * =================================================================
 *  - The pipeline is ASYNC end-to-end. This is the door through which
 *    streaming SSR and server data fetching walk in later. Compiled
 *    ssr() functions are async and `await` their component includes.
 *  - renderToHtml() understands both component generations: functional
 *    components (module default export → instantiate with a lifecycle
 *    instance) and legacy SFC modules ({ ssr }).
 *
 * The per-request render context (styles + islands) is the mechanism
 * behind "zero JS unless islands exist".
 *
 * REQUEST ISOLATION (RFC-0016): a single module-level `let ctx` variable
 * was the original implementation — correct only under the (unstated,
 * and false) assumption that requests never interleave. Because
 * renderToHtml()/renderIsland() are genuinely async (a component's own
 * ssr() can await arbitrary work — a plugin's codegen hook, a future
 * data-fetching component), a second request's beginRender() can fire
 * while a first request is still suspended mid-await on the same event
 * loop. With plain module state, the second request's beginRender()
 * silently clobbers the first's in-flight context — a real,
 * reproduced-live bug (see RFC-0016's Verification): concurrent
 * requests either corrupt each other's island/style collections
 * (server-A's response containing server-B's islands) or crash with
 * "renderIsland() outside of a server render," depending on exact
 * timing. `AsyncLocalStorage` fixes this with zero call-site changes —
 * every existing beginRender()/endRender()/registerStyle()/renderIsland()
 * call in server/dev.ts, server/build.ts, server/serve.ts keeps its
 * exact signature; isolation is automatic per async call chain.
 *
 * BROWSER-BUNDLED, NODE-ONLY IMPORT (real constraint, found live):
 * this whole module gets bundled into `dist/client/runtime.js`
 * (server/build.ts's Step 3) even though beginRender()/endRender()/
 * renderIsland() are only ever CALLED server-side — the client and
 * server share one `runtime/index.ts` entry point, and this file's own
 * original header comment ("browser-safe: no Node APIs") was a real
 * constraint, not decoration. A static `import { AsyncLocalStorage }
 * from 'node:async_hooks'` breaks Vite's browser build outright
 * (Rollup: "AsyncLocalStorage is not exported by
 * __vite-browser-external:node:async_hooks") — confirmed live via a
 * real `npm run build` failure, not a hypothetical. The class is
 * instead loaded lazily, once, on first server-side call — `node:` is
 * a dynamic `import()` specifier here specifically so Rollup's browser
 * build treats it as a normal external/unresolved dynamic import
 * (never evaluated, since beginRender() is never called client-side)
 * instead of a hard static-analysis failure.
 */
import { escapeAttr } from './escape';
import { instantiate } from './mount';
import type { FunctionalComponent } from './mount';
import type { AsyncLocalStorage as AsyncLocalStorageType } from 'node:async_hooks';

export interface IslandRef {
  src: string; // root-relative module URL, e.g. /src/components/TodoList.najm
  props: unknown;
}

export interface RenderContext {
  islands: IslandRef[];
  styles: Set<string>;
}

let storagePromise: Promise<AsyncLocalStorageType<RenderContext>> | null = null;
let resolvedStorage: AsyncLocalStorageType<RenderContext> | null = null;
function getStorage(): Promise<AsyncLocalStorageType<RenderContext>> {
  if (!storagePromise) {
    storagePromise = import('node:async_hooks').then((m) => {
      resolvedStorage = new m.AsyncLocalStorage<RenderContext>();
      return resolvedStorage;
    });
  }
  return storagePromise;
}

/**
 * Called by the server before invoking a page's render. Establishes a
 * NEW async context scoped to `fn` — every beginRender()-through-
 * endRender() call in this module's other functions, for the rest of
 * this function's synchronous AND asynchronous execution (including
 * every `await` inside it), reads/writes THIS context, never a
 * concurrently-running request's. This is what closes the race: two
 * overlapping `run()` calls each get their own isolated store, even
 * when their awaits interleave on the same event loop tick.
 *
 * Async (unlike the pre-fix synchronous `beginRender()`) ONLY for the
 * one-time `import('node:async_hooks')` the first call pays — every
 * server call site already does `await runtime.beginRender(async () =>
 * ...)`, since `fn` itself needs to be async to await the render, so
 * this is not a new burden on any real caller.
 */
export async function beginRender<T>(fn: () => T | Promise<T>): Promise<T> {
  const s = await getStorage();
  return s.run({ islands: [], styles: new Set() }, fn);
}

/** Called by the server, still inside beginRender()'s fn, after the render; yields what it collected. */
export function endRender(): RenderContext {
  const ctx = resolvedStorage?.getStore();
  if (!ctx) throw new Error('[najm] endRender() called outside beginRender()\'s callback');
  return ctx;
}

/** Compiled ssr() functions register their component's <style> here. */
export function registerStyle(css: string): void {
  resolvedStorage?.getStore()?.styles.add(css);
}

/** SSR attribute serialization, mirroring the client's setAttr semantics. */
export function attr(name: string, value: unknown): string {
  if (value == null || value === false) return '';
  if (value === true) return ` ${name}`;
  return ` ${name}="${escapeAttr(value)}"`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

interface LegacyModule {
  ssr(props?: Record<string, unknown>): string | Promise<string>;
}

/**
 * Render anything renderable to HTML:
 *   - a Beta functional component (or a module whose default export is one):
 *     run setup with a fresh lifecycle instance, await its view's ssr().
 *     Hooks register but onMounted never fires — SSR has no DOM.
 *   - a legacy v0.1 SFC module: call its ssr(props) directly.
 */
export async function renderToHtml(
  target: unknown,
  props: Record<string, unknown> = {}
): Promise<string> {
  const comp: any = (target as any)?.default ?? target;
  if (typeof comp === 'function') {
    const { view } = instantiate(comp as FunctionalComponent, props);
    return await view.ssr();
  }
  if (comp && typeof comp.ssr === 'function') {
    return await (comp as LegacyModule).ssr(props);
  }
  throw new Error(
    '[najm] renderToHtml: expected a functional component or a compiled ' +
      '.najm module (did you import a legacy SFC with a default import?)'
  );
}

/**
 * A static component include: render to HTML, ship no JS.
 *
 * Error-boundary awareness (RFC-0006): this call site does NOT catch on
 * its own — that would make isolation the default for every component,
 * which the RFC explicitly rejects ("you're adding an opt-in isolation
 * mechanism, not silently swallowing all errors everywhere"). Isolation
 * happens because `withErrorBoundary()` (runtime/error-boundary.ts)
 * wraps a component's own ssr() in a try/catch BEFORE it ever reaches
 * this function — from here, a boundary-wrapped component's ssr() just
 * returns the fallback HTML like any other successful render, and an
 * unwrapped component's throw propagates through renderToHtml()
 * untouched, all the way to the caller (server/dev.ts's outer
 * try/catch), preserving today's "fail the whole request" behavior for
 * anyone who didn't opt in.
 */
export async function renderComponent(
  comp: unknown,
  props: Record<string, unknown>
): Promise<string> {
  return renderToHtml(comp, props);
}

/**
 * An island include: render to HTML *and* record that this subtree must
 * be hydrated. Props are serialized into the wrapper so the client can
 * replay component setup with identical inputs (JSON-serializable only —
 * that constraint IS the wire).
 *
 * `strategy` is the compiled directive: `'load'` (default, eager — the
 * original verified mechanism) or `'visible'` (RFC-0007 partial
 * hydration — defer until the element intersects the viewport).
 * `'load'` is deliberately NOT written as a `data-hydrate` attribute:
 * omitting it keeps a `client:load` island's wrapper markup byte-for-byte
 * identical to before this directive existed, which is the regression
 * guard this RFC increment must not violate. Only `'visible'` emits the
 * marker the client's hydrateIslands() branches on.
 *
 * Same error-boundary posture as renderComponent() above: no catch here.
 * A `withErrorBoundary`-wrapped island's ssr() already resolves to
 * fallback HTML by the time it reaches this function, so the island
 * wrapper markup (`<najm-island>`) is still emitted around it — the
 * island remains hydratable, it just hydrates fallback-shaped content
 * unless the real render recovers. An unwrapped island's throw still
 * propagates and fails the request, same as any other component.
 */
export async function renderIsland(
  comp: unknown,
  src: string,
  props: Record<string, unknown>,
  strategy: 'load' | 'visible' = 'load'
): Promise<string> {
  const ctx = resolvedStorage?.getStore();
  if (!ctx) throw new Error('[najm] renderIsland() outside of a server render');
  ctx.islands.push({ src, props });
  const inner = await renderToHtml(comp, props);
  const hydrateAttr = strategy === 'visible' ? ` data-hydrate="visible"` : '';
  return (
    `<najm-island style="display:contents"` +
    ` data-src="${escapeAttr(src)}"` +
    `${hydrateAttr}` +
    ` data-props="${escapeAttr(JSON.stringify(props))}">` +
    inner +
    `</najm-island>`
  );
}
