/**
 * Middleware — v1.0 Phase 3.2
 * =================================================================
 * A `middleware.ts` file next to (or above) a page in src/pages runs
 * BEFORE that page renders — auth checks, redirects, header injection.
 * Middleware files stack outermost-first (root middleware runs before
 * a nested directory's), matching layouts' nesting order, and any
 * middleware in the chain can short-circuit the rest by returning a
 * MiddlewareResult other than "continue".
 *
 * Contract (deliberately small — this is server-side routing
 * middleware, not a full HTTP framework):
 *
 *   export default function middleware(ctx: MiddlewareContext): MiddlewareResult
 *
 * Sync or async; the router awaits either. Returning undefined/void is
 * shorthand for { type: "next" }.
 */

export interface MiddlewareContext {
  pathname: string;
  params: Record<string, string | string[]>;
  /** Raw request headers, lowercased keys — enough for auth/cookie checks
   *  without exposing the full Node IncomingMessage to route code. */
  headers: Record<string, string>;
}

export type MiddlewareResult =
  | { type: 'next' }
  | { type: 'redirect'; to: string; status?: 301 | 302 | 307 | 308 }
  | { type: 'reject'; status: number; body?: string }
  | void;

export interface MiddlewareModule {
  default(ctx: MiddlewareContext): MiddlewareResult | Promise<MiddlewareResult>;
}

/**
 * Run a chain of already-loaded middleware modules in order, stopping
 * at the first non-"next" result. This function is intentionally pure
 * (no Node http types) so it's unit-testable without a real server.
 */
export async function runMiddlewareChain(
  modules: MiddlewareModule[],
  ctx: MiddlewareContext
): Promise<Exclude<MiddlewareResult, void | { type: 'next' }> | null> {
  for (const mod of modules) {
    const result = await mod.default(ctx);
    if (result && result.type !== 'next') return result;
  }
  return null;
}
