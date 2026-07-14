/**
 * Resumability runtime — v1.0 Phase 3.1 PROTOTYPE (opt-in, not default)
 * =================================================================
 * SCOPE, STATED UP FRONT: this is a working spike proving the
 * mechanism end-to-end, reachable via `client:resume` as an
 * ALTERNATIVE to `client:load` on a per-component basis. It is not
 * Mono's default hydration strategy and the Beta claim-walk hydration
 * (mount.ts / hydrate.ts) is unchanged and unaffected. Promoting this
 * to a default would require the compiler's entire output shape to
 * change (see the header comment in resume-codegen.ts) and is
 * explicitly scoped OUT of this round, per the going-in agreement that
 * this ships as an opt-in prototype, not a retrofit of Beta's model.
 *
 * WHY RESUMABILITY IS A DIFFERENT ARCHITECTURE, NOT A HYDRATION MODE:
 *
 * Beta's `hydrate(root)` is a CLOSURE returned from calling the
 * component function again — `count.value++` in a click handler works
 * because `count` is a live variable captured by that closure. That
 * requires re-running setup on the client, which is exactly the O(app
 * size) cost resumability exists to eliminate.
 *
 * Resumability instead requires that a click handler be reconstructible
 * from DATA ALONE, with no closure ever created on the client until
 * the moment of interaction:
 *
 *   1. SERVER: every signal a resumable component creates is registered
 *      in a serialization graph and assigned a stable PATH (not a JS
 *      reference — references don't survive going through HTML). Event
 *      bindings are compiled to a QRL (Qwik's own term: a "qualified
 *      resource locator") — a string like
 *      "/src/components/Counter.mono#onClick" that names a chunk and an
 *      export, not a captured function value.
 *   2. The whole graph (signal paths → values, node → QRL bindings) is
 *      serialized into HTML attributes on the root element. No
 *      framework JS need run to produce the initial paint; the SSR
 *      string already has the interactive markup baked in.
 *   3. CLIENT: a bootloader (bootloader.ts — deliberately small, no
 *      component code) installs ONE root listener per event type
 *      (event delegation) and does nothing else at page load. This is
 *      the O(1): startup cost does NOT grow with how many components
 *      or how many potential handlers the page has.
 *   4. ON INTERACTION: the delegated listener reads the QRL off the
 *      event target's nearest `q:on:*` attribute, dynamically imports
 *      JUST that handler chunk, reconstructs the signal(s) it closes
 *      over FROM THE SERIALIZED GRAPH (not from re-running setup), and
 *      invokes it. Cost is now O(1) in app size and proportional only
 *      to the ONE component the user actually touched.
 *
 * This module is the client-side half of steps 3–4: the graph reader
 * and the resumed-signal reconstruction. bootloader.ts is step 3's
 * entry point. resume-codegen.ts (compiler-side) is step 1–2.
 */
import { signal, type Signal } from './signals';

const GRAPH_ATTR = 'data-mono-resume';

export interface SerializedGraph {
  /** path (e.g. "0.count") → JSON-serializable initial value */
  signals: Record<string, unknown>;
}

/** Server-side: called by compiled resumable components to register a signal's path. */
export function registerResumableSignal(
  graph: SerializedGraph,
  path: string,
  sig: Signal<unknown>
): void {
  graph.signals[path] = sig.peek();
}

/** Server-side: serialize the graph into the attribute payload for the root element. */
export function serializeGraph(graph: SerializedGraph): string {
  return JSON.stringify(graph);
}

/**
 * Client-side: a lazily-reconstructed table of Signals, keyed by the
 * SAME paths the server assigned. Resumed handlers look signals up
 * here instead of closing over them — this table, not a closure, is
 * what makes a handler's dependencies data rather than captured state.
 */
export class ResumedState {
  private signals = new Map<string, Signal<unknown>>();

  constructor(private readonly graph: SerializedGraph) {}

  /** Get-or-create the Signal for `path`, seeded from its serialized value. */
  signal<T>(path: string): Signal<T> {
    let s = this.signals.get(path);
    if (!s) {
      s = signal(this.graph.signals[path]);
      this.signals.set(path, s);
    }
    return s as Signal<T>;
  }
}

/** Read and parse the resume graph attribute off an island root, if present. */
export function readGraph(root: Element): ResumedState | null {
  const raw = root.getAttribute(GRAPH_ATTR);
  if (!raw) return null;
  return new ResumedState(JSON.parse(raw) as SerializedGraph);
}

export { GRAPH_ATTR };
