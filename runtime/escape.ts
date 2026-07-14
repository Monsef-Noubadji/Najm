/**
 * Shared display/escaping helpers — used by SSR string building on the
 * server and by text bindings on the client, so both sides render
 * values identically (which is what makes hydration line up).
 */

/** JSX display semantics: null/undefined/booleans render as nothing. */
export function toDisplay(v: unknown): string {
  if (v == null || typeof v === 'boolean') return '';
  return String(v);
}

/** Escape a value for an HTML text position. */
export function escapeHtml(v: unknown): string {
  return toDisplay(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a value for a double-quoted attribute position. */
export function escapeAttr(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
