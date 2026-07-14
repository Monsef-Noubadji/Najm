/**
 * Najm language server — diagnostics provider (RFC-0012)
 * =================================================================
 * A direct, un-adapted consumer of `compiler/semantics.ts`'s
 * `analyzeSemantics()` — see that module's doc comment ("Intended for
 * tooling (RFC-0012's future language server)") and this RFC's Design
 * section. This file's ONLY job is turning `Diagnostic[]` (identifier +
 * expr, no position) into LSP `Diagnostic[]` (identifier + expr + a real
 * `{line, character}` range), by locating each `expr` in the document
 * text and the `identifier`'s offset within it — no semantic re-analysis
 * happens here.
 */
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic as LspDiagnostic } from 'vscode-languageserver/node';
import { analyzeSemantics } from '../compiler/semantics';
import { extractDocument } from './extract';
import { rangeForIdentifierInExpr, offsetToPosition } from './positions';

/**
 * Compute LSP diagnostics for one `.najm` document's full text. Returns
 * `[]` if the document can't be extracted (unparseable template, no
 * `<template>`/`return { template }` boundary found) rather than
 * throwing — an editor should simply show no diagnostics for a file
 * that's mid-edit into an invalid shape, not crash the server.
 */
export function getDiagnostics(uri: string, text: string): LspDiagnostic[] {
  const doc = extractDocument(text, uri);
  if (!doc) return [];

  const { diagnostics } = analyzeSemantics(text, doc.ast);
  const out: LspDiagnostic[] = [];
  // Track a per-expr search cursor so multiple diagnostics that happen to
  // share the exact same `expr` text (e.g. the same unresolved
  // expression appearing twice) map to their OWN occurrence in document
  // order, not all collapsing onto the first match.
  const searchFrom = new Map<string, number>();

  for (const d of diagnostics) {
    const from = searchFrom.get(d.expr) ?? doc.templateStart;
    const range = rangeForIdentifierInExpr(text, d.expr, d.identifier, from);
    if (!range) {
      // Location genuinely not found (shouldn't happen for a real
      // diagnostic against this same document, but never crash the
      // server over a range-mapping miss) — fall back to a zero-width
      // range at the template start rather than dropping the diagnostic.
      const pos = offsetToPosition(text, doc.templateStart);
      out.push({
        severity: DiagnosticSeverity.Error,
        range: { start: pos, end: pos },
        message: d.message,
        source: 'najm',
      });
      continue;
    }
    // Advance the search cursor past this occurrence so the NEXT
    // diagnostic sharing the same expr text finds the next one.
    const exprOffset = text.indexOf(d.expr, from);
    searchFrom.set(d.expr, exprOffset + d.expr.length);

    out.push({
      severity: DiagnosticSeverity.Error,
      range,
      message: d.message,
      source: 'najm',
    });
  }
  return out;
}
