/**
 * Error boundaries — see docs/rfcs/RFC-0006-ssr-and-rendering.md
 * =================================================================
 * RFC-0006 leaves an open question: ship the boundary as a runtime
 * wrapper (`withErrorBoundary`) or as compiler-recognized `catch` sugar
 * on a component's authored source? This implements the runtime
 * wrapper — the RFC's own stated lean for the smaller v1 slice, and it
 * needs zero RFC-0003 codegen changes.
 *
 * withErrorBoundary(comp, onError) returns a new FunctionalComponent
 * whose view intercepts comp's own ssr()/hydrate():
 *
 *   - ssr() throwing (sync or async — components may be async per
 *     RFC-0002) is caught and onError(error, 'ssr') is spliced in as
 *     the fallback HTML instead of propagating.
 *   - hydrate() throwing is caught, logged, and reported via onError —
 *     see the judgment call below for why it does not also try to
 *     rewrite the DOM.
 *
 * An UNWRAPPED component is untouched: nothing here changes what
 * renderComponent()/renderIsland() do, so a component that never opts
 * in still fails its whole page exactly like today. Boundaries are
 * opt-in isolation, not a global safety net.
 */
import type { ComponentView, FunctionalComponent } from './mount';

export type ErrorPhase = 'ssr' | 'hydrate';
export type OnError = (error: unknown, phase: ErrorPhase) => string;

/**
 * Wrap a component so failures in its own ssr()/hydrate() are caught
 * and replaced with onError()'s fallback HTML instead of propagating.
 *
 * Judgment call on hydrate-phase handling: hydrate() returns void, and
 * client.ts's hydrateIslands() already wraps every island's hydrate()
 * call in its own try/catch (log + leave the island's SSR'd markup in
 * place, inert) — that is the existing, tested "default, unnamed
 * boundary" RFC-0006 formalizes. Rewriting the DOM via innerHTML from
 * inside this wrapper would run a second time for every island
 * regardless of whether it opted in, and would race/duplicate the
 * isolation client.ts already performs. So this wrapper's hydrate()
 * catches, calls onError() for reporting/logging parity with the SSR
 * path (and so a caller-supplied onError sees BOTH phases as the RFC's
 * interface promises), but re-throws afterward — client.ts's existing
 * per-island catch is left to do the one actual DOM-safety action
 * (leave SSR'd HTML inert) exactly as it does for unwrapped components
 * today. This avoids a second, competing recovery mechanism for the
 * same failure while still giving onError visibility into hydrate
 * failures as the RFC's onError(error, phase) signature requires.
 */
export function withErrorBoundary(
  comp: FunctionalComponent,
  onError: OnError
): FunctionalComponent {
  return (props?: Record<string, unknown>): ComponentView => {
    // A functional component's body IS its setup phase (RFC-0002): setup
    // and the first render are one inseparable pass, so a throw during
    // comp(props) itself — e.g. a guard clause before `return { template }`
    // — is exactly what "this component's ssr() failed" means from the
    // outside. It must be caught here too, not just inside inner.ssr().
    let inner: ComponentView | undefined;
    let setupError: { error: unknown } | undefined;
    try {
      inner = comp(props);
    } catch (error) {
      setupError = { error };
    }

    return {
      async ssr(): Promise<string> {
        if (setupError) return onError(setupError.error, 'ssr');
        try {
          return await inner!.ssr();
        } catch (error) {
          return onError(error, 'ssr');
        }
      },

      async hydrate(root: Element): Promise<void> {
        if (setupError) {
          onError(setupError.error, 'hydrate');
          throw setupError.error;
        }
        try {
          await inner!.hydrate(root);
        } catch (error) {
          onError(error, 'hydrate'); // reporting parity with the ssr phase
          throw error; // let client.ts's existing per-island isolation handle the DOM
        }
      },
    };
  };
}
