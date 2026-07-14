import type { MiddlewareContext, MiddlewareResult } from '../../../router/middleware';

/**
 * Example middleware for RFC-0008 verification: rejects every request
 * under /admin unless it carries an (obviously toy) auth header, proving
 * the reject path short-circuits before the page ever renders.
 */
export default function middleware(ctx: MiddlewareContext): MiddlewareResult {
  if (ctx.headers['x-najm-admin'] !== 'yes') {
    return { type: 'reject', status: 403, body: 'Forbidden — missing x-najm-admin header' };
  }
  return { type: 'next' };
}
