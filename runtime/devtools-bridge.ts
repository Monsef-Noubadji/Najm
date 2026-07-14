/**
 * Store DevTools bridge — v1.0 Phase 2.1 (time-travel debugging)
 * =================================================================
 * A store's $subscribe() already fires on every committed action; this
 * module is a small recorder built on top of it that keeps a bounded
 * history of (action, args, resulting state snapshot) and can replay
 * any point in that history via $replaceState(). It is intentionally
 * framework-agnostic about WHERE the UI lives: the Najm DevTools
 * browser extension (tooling/najm-devtools/) is a consumer of exactly
 * this API via window.postMessage — see that package's README for the
 * wire protocol. This module has zero DOM/extension dependencies so it
 * also works acceptance-tested, headless, in CI.
 */
import type { Store } from './store';

export interface HistoryEntry {
  index: number;
  action: string;
  args: unknown[];
  /** Deep-cloned snapshot taken AFTER the action committed. */
  snapshot: unknown;
  at: number;
}

export interface TimeTravelController {
  history(): readonly HistoryEntry[];
  /** Jump state to exactly the snapshot recorded at `index`. */
  jumpTo(index: number): void;
  /** Clear recorded history without touching current state. */
  clear(): void;
}

/**
 * Attach recording to any store produced by defineStore(). Call once,
 * near app startup, only for stores you want inspectable — production
 * builds simply never call this, so the recorder (and its snapshot
 * cloning cost) doesn't exist in the shipped bundle.
 */
export function enableTimeTravel<S extends object>(
  store: Store<S, any, any>,
  opts: { limit?: number } = {}
): TimeTravelController {
  const limit = opts.limit ?? 200;
  const entries: HistoryEntry[] = [];
  let replaying = false;

  store.$subscribe((action, args, state) => {
    if (replaying) return; // don't record the jump itself as an action
    entries.push({
      index: entries.length,
      action,
      args,
      snapshot: structuredClone(state),
      at: Date.now(),
    });
    if (entries.length > limit) entries.shift();
    broadcast({ type: 'najm-devtools:action', action, args, entries: entries.length });
  });

  return {
    history: () => entries,
    jumpTo(index: number) {
      const entry = entries[index];
      if (!entry) throw new Error(`[najm] no recorded state at history index ${index}`);
      replaying = true;
      try {
        store.$replaceState(structuredClone(entry.snapshot) as S);
      } finally {
        replaying = false;
      }
      broadcast({ type: 'najm-devtools:jump', index });
    },
    clear() {
      entries.length = 0;
    },
  };
}

/** Fire-and-forget postMessage to the extension's content script, if present. */
function broadcast(msg: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'najm-devtools-bridge', ...msg }, '*');
  }
}
