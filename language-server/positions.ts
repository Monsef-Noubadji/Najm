/**
 * Najm language server — offset <-> LSP Position mapping (RFC-0012)
 * =================================================================
 * `compiler/semantics.ts`'s `Diagnostic` intentionally carries no
 * line/character range (RFC-0012's Design section: "mapping
 * expression-relative to document-relative positions is THIS module's
 * job, not a `compiler/semantics.ts` change"). Everything here is pure
 * text-offset arithmetic over the ORIGINAL document string — no parsing,
 * no forked grammar.
 */
import type { Position, Range } from 'vscode-languageserver/node';

/** Convert a 0-based character offset into a document into an LSP `{line, character}` position. */
export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** Convert an LSP `{line, character}` position back into a 0-based document offset. */
export function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  let line = 0;
  while (line < position.line) {
    const nl = text.indexOf('\n', offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
    line++;
  }
  return Math.min(offset + position.character, text.length);
}

/**
 * Locate `identifier` as a whole-word match inside `expr`, honoring
 * `occurrence` for the rare case an identifier appears more than once in
 * the same expression (0-based; defaults to the first occurrence).
 * Returns -1 if not found.
 */
export function findIdentifierOffsetInExpr(expr: string, identifier: string, occurrence = 0): number {
  const re = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g');
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(expr))) {
    if (count === occurrence) return m.index;
    count++;
  }
  return -1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build an LSP `Range` for one occurrence of `identifier` inside `expr`,
 * where `expr` itself is located within `documentText` starting the
 * search at `searchFrom` (so repeated identical `expr` strings elsewhere
 * in the document — e.g. the same `{count}` used twice — don't all
 * collapse onto the first occurrence). Returns `null` if `expr` or
 * `identifier` can't be located.
 */
export function rangeForIdentifierInExpr(
  documentText: string,
  expr: string,
  identifier: string,
  searchFrom = 0
): Range | null {
  const exprOffset = documentText.indexOf(expr, searchFrom);
  if (exprOffset < 0) return null;
  const idOffsetInExpr = findIdentifierOffsetInExpr(expr, identifier);
  if (idOffsetInExpr < 0) return null;
  const start = exprOffset + idOffsetInExpr;
  const end = start + identifier.length;
  return {
    start: offsetToPosition(documentText, start),
    end: offsetToPosition(documentText, end),
  };
}
