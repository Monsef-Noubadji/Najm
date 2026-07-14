/**
 * najm lint — compiler-native `.najm` diagnostics (RFC-0011)
 * =================================================================
 * Deliberately narrow: runs every `.najm` file under `src/` through
 * `compiler/parse.ts`'s real `parseTemplate()` (parse errors) and
 * `compiler/semantics.ts`'s real `analyzeSemantics()` (unresolved-
 * identifier diagnostics) — the SAME functions `compile()` and the
 * language server both already use. Template extraction (functional
 * vs. SFC dispatch) reuses `language-server/extract.ts`'s
 * `extractDocument()` rather than re-forking that dispatch a third
 * time, per RFC-0011's explicit zero-duplication requirement.
 *
 * NOT a general JS/TS linter — no ESLint, no style rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractBlocks, parseTemplate } from '../compiler/parse';
import { analyzeSemantics } from '../compiler/semantics';
import { extractDocument } from '../language-server/extract';

export interface LintDiagnostic {
  file: string;
  /** 1-based line number within the FULL document (not template-relative). */
  line: number;
  message: string;
}

/** Every `.najm` file under `dir`, recursively. */
export function findNajmFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.najm')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** 1-based line number for a character offset within `text`. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/** Lint a single `.najm` file's already-read source. Never throws. */
export function lintSource(file: string, source: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  // Reuse the LSP's own extraction dispatch (functional vs. SFC, finds
  // the template/script boundary) — this ALSO gives us a real parse +
  // real scope, so in the common case no second parseTemplate() call is
  // needed at all. extractDocument() swallows parse errors internally
  // (returns null), so on failure we re-run parseTemplate() directly,
  // over the best-effort template slice, purely to surface the real
  // parse error message/location — extractDocument() itself never
  // exposes why extraction failed.
  const doc = extractDocument(source, file);
  if (!doc) {
    // Fall back to locating *a* <template> block or a functional
    // `return { template: ... }` well enough to report a parse error;
    // if neither is even present, report that directly.
    const hasTemplateTag = /<template[\s>]/.test(source);
    const isFunctional = /(^|\n)\s*export\s+default\s+function/.test(source);
    if (!hasTemplateTag && !isFunctional) {
      diagnostics.push({ file, line: 1, message: 'no <template> block or `export default function` component found' });
      return diagnostics;
    }
    try {
      // Re-run the extraction path's own parse step so the real error
      // message (from compiler/parse.ts) surfaces instead of a generic
      // "couldn't extract" message. Functional-style parse errors are
      // already covered by extractDocument()'s functional branch above
      // (extractFunctionalParts()); this fallback only needs to
      // re-derive the SFC path's <template> block.
      if (!isFunctional) {
        const blocks = extractBlocks(source, file);
        parseTemplate(blocks.template, file);
      }
    } catch (err) {
      diagnostics.push({ file, line: 1, message: (err as Error).message });
      return diagnostics;
    }
    diagnostics.push({ file, line: 1, message: 'could not extract template from this file' });
    return diagnostics;
  }

  const { diagnostics: semanticDiagnostics } = analyzeSemantics(source, doc.ast);
  for (const d of semanticDiagnostics) {
    const exprOffset = source.indexOf(d.expr, doc.templateStart);
    const offset = exprOffset >= 0 ? exprOffset : doc.templateStart;
    diagnostics.push({ file, line: lineOf(source, offset), message: d.message });
  }

  return diagnostics;
}

/** Lint every `.najm` file under `srcDir`. */
export function lintDir(srcDir: string): LintDiagnostic[] {
  const files = findNajmFiles(srcDir);
  const diagnostics: LintDiagnostic[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    diagnostics.push(...lintSource(file, source));
  }
  return diagnostics;
}

export function formatLintReport(diagnostics: LintDiagnostic[], root: string): string {
  if (diagnostics.length === 0) return 'najm lint: no problems found';
  const lines = diagnostics.map((d) => `${path.relative(root, d.file).split(path.sep).join('/')}:${d.line}  ${d.message}`);
  return [...lines, '', `najm lint: ${diagnostics.length} problem(s) found`].join('\n');
}
