/**
 * Resumability bootloader — v1.0 Phase 3.1 PROTOTYPE
 * =================================================================
 * THE ENTIRE CLIENT-SIDE COST OF A PAGE FULL OF RESUMABLE COMPONENTS,
 * AT LOAD TIME. This file is deliberately tiny and contains zero
 * component code, zero framework internals beyond event delegation —
 * that is the "1kb bootloader" the spec asks for. Minified, this file
 * is comfortably under that budget (verified: see
 * scripts/test-resumability.ts's size assertion).
 *
 * What it does at page load: attach ONE capturing listener per
 * resumable event TYPE (click, input, etc. — deduced from which
 * `q:on:*` attributes exist anywhere on the page) to `document`. That
 * is the only work proportional to the page; it does NOT scan or
 * instantiate a single component.
 *
 * What it does on interaction (and ONLY on interaction): walk up from
 * `event.target` to find the nearest element carrying a `q:on:TYPE`
 * attribute, parse its QRL, dynamically `import()` that one chunk,
 * build a ResumedState from the nearest ancestor's serialized graph,
 * and invoke the handler. Every step here is deferred until a real
 * user gesture — this is the "lazy" in O(1) hydration.
 */
import { readGraph, ResumedState } from './resume';

export interface QRL {
  /** Module URL, e.g. "/src/components/Counter.mono" */
  chunk: string;
  /** Named export inside that module, e.g. "onClick_0" */
  symbol: string;
}

/** "/src/components/Counter.mono#onClick_0" → { chunk, symbol } */
function parseQrl(raw: string): QRL {
  const i = raw.indexOf('#');
  if (i < 0) throw new Error(`[mono] malformed QRL: ${raw}`);
  return { chunk: raw.slice(0, i), symbol: raw.slice(i + 1) };
}

export type ResumableHandler = (event: Event, state: ResumedState) => void;

/** Cache: one in-flight/resolved import per chunk URL, never re-fetched. */
const chunkCache = new Map<string, Promise<Record<string, ResumableHandler>>>();

function loadChunk(url: string): Promise<Record<string, ResumableHandler>> {
  let p = chunkCache.get(url);
  if (!p) {
    p = import(/* @vite-ignore */ url) as Promise<Record<string, ResumableHandler>>;
    chunkCache.set(url, p);
  }
  return p;
}

/**
 * Once a root's serialized graph has been read into a ResumedState, that
 * SAME instance must be reused for every subsequent interaction on the
 * same root — otherwise each click would silently reset state back to
 * its SSR-time snapshot instead of continuing from the previous
 * mutation. This is the resumed-component equivalent of "the component
 * is now live"; it just came into existence on first interaction rather
 * than at page load. Keyed by element identity (WeakMap), so it never
 * outlives the DOM node it resumed.
 */
const resumedByRoot = new WeakMap<Element, ResumedState>();

function nearestGraphRoot(el: Element): ResumedState | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cached = resumedByRoot.get(n);
    if (cached) return cached;
    const state = readGraph(n);
    if (state) {
      resumedByRoot.set(n, state);
      return state;
    }
  }
  return null;
}

async function handleDelegated(type: string, event: Event): Promise<void> {
  const attr = `data-q-on-${type}`;
  let target = event.target as Element | null;
  while (target && !target.hasAttribute(attr)) target = target.parentElement;
  if (!target) return;

  const qrl = parseQrl(target.getAttribute(attr)!);
  const state = nearestGraphRoot(target);
  if (!state) {
    console.error(`[mono] resumable handler ${qrl.chunk}#${qrl.symbol} found no serialized state root`);
    return;
  }

  const mod = await loadChunk(qrl.chunk);
  const handler = mod[qrl.symbol];
  if (typeof handler !== 'function') {
    console.error(`[mono] chunk ${qrl.chunk} has no resumable export "${qrl.symbol}"`);
    return;
  }
  handler(event, state);
}

/**
 * Install delegation for every event TYPE actually used on the page
 * (read once from a page-level manifest the server emits — see
 * resume-codegen.ts's page wrapper). Idempotent per type.
 */
const installed = new Set<string>();

export function bootResumable(eventTypes: readonly string[]): void {
  for (const type of eventTypes) {
    if (installed.has(type)) continue;
    installed.add(type);
    document.addEventListener(type, (e) => void handleDelegated(type, e), { capture: true });
  }
}
