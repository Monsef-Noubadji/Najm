/**
 * najm/core — the single import surface for user code and for the
 * compiler's generated output alike. (Aliased as both 'najm/core' and
 * published as the `najm` package (with a `./core` subpath export).)
 */
export {
  Signal,
  signal,
  computed,
  effect,
  batch,
  untrack,
  onCleanup,
  isSignal,
  get,
  createRoot,
  withEffectObserver,
  currentOwner,
} from './signals';
export type { ReadonlySignal, Cleanup, OwnerHandle } from './signals';

export { defineStore } from './store';
export type { Store, StoreDefinition, Mutator, Getter } from './store';

export { enableTimeTravel } from './devtools-bridge';
export type { HistoryEntry, TimeTravelController } from './devtools-bridge';

export { enableGraphInspector, snapshot } from './devtools-graph';
export type { GraphSnapshot } from './devtools-graph';

export { enableFlushTiming } from './devtools-timing';
export type { FlushEvent } from './devtools-timing';

export { createContext, provide, inject } from './context';
export type { Context } from './context';

export {
  ComponentInstance,
  currentInstance,
  runWithInstance,
  onMounted,
  onUpdated,
  onDestroyed,
} from './lifecycle';

export { instantiate, mountComponent } from './mount';
export type { ComponentView, FunctionalComponent, MountedComponent } from './mount';

export { toDisplay, escapeHtml, escapeAttr } from './escape';

export { bindText, bindAttr, setAttr, bindValue, bindChecked, listen } from './dom';

export { claim, eachBlock, hoistTemplate } from './hydrate';
export type { ClaimCursor } from './hydrate';

export {
  beginRender,
  endRender,
  registerStyle,
  attr,
  renderToHtml,
  renderComponent,
  renderIsland,
} from './ssr';
export type { IslandRef, RenderContext } from './ssr';

export { hydrateIslands } from './client';

export { withErrorBoundary } from './error-boundary';
export type { OnError, ErrorPhase } from './error-boundary';
