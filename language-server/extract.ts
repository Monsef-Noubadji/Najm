/**
 * Najm language server — template extraction (RFC-0012)
 * =================================================================
 * The ONE place the LSP decides "is this file functional-component-style
 * or legacy-SFC-style, and where does its template/script live" — reused
 * by diagnostics, go-to-definition, and completion so none of them ever
 * re-derive that boundary themselves.
 *
 * This is a thin adapter over the REAL compiler functions, matching
 * RFC-0012's non-negotiable constraint (no second grammar, no forked
 * template extraction):
 *
 *   - `compiler/codegen.ts`'s `compile()` dispatch regex
 *     (`/(^|\n)\s*export\s+default\s+function/`) decides functional vs.
 *     SFC — this module uses the exact same regex (also the one
 *     `compiler/semantics.ts`'s `analyzeSemantics()` uses internally),
 *     so the LSP can never classify a file differently than the real
 *     compiler would.
 *   - Functional components: `compiler/codegen.ts`'s exported
 *     `extractFunctionalParts()` (the same function `compileFunctional()`
 *     calls) finds the `return { template: \`...\` }` boundary.
 *   - SFC files: `compiler/parse.ts`'s `extractBlocks()` (the same
 *     function `compileSFC()` calls) splits `<script>/<template>/<style>`.
 *
 * `template` here is exactly the string `parseTemplate()` is fed in the
 * real compile path, at the same source offset it starts at within the
 * ORIGINAL document — `templateStart` is what lets diagnostics/
 * completion map back from template-relative reasoning to document
 * positions.
 */
import { extractBlocks, parseTemplate } from '../compiler/parse';
import type { TNode } from '../compiler/parse';
import { extractFunctionalParts } from '../compiler/codegen';
import { scanDeclarations, extractParamSource } from '../compiler/semantics';
import type { Scope } from '../compiler/semantics';

export interface ExtractedNajm {
  style: 'functional' | 'sfc';
  /** The template source, exactly as `parseTemplate()` receives it in the real compile path. */
  template: string;
  /** Offset of `template`'s first character within the full document text. */
  templateStart: number;
  /** The declared-scope script source (mirrors what `analyzeSemantics()`/`compileFunctional`/`compileSFC` scan). */
  scriptSource: string;
  /** Offset of `scriptSource`'s first character within the full document text (0 unless functional-with-leading-imports skips nothing — see extractDocument). */
  scriptStart: number;
  ast: TNode[];
  scope: Scope;
}

/** Same dispatch `compile()` and `analyzeSemantics()` both use — kept identical on purpose. */
export function isFunctionalStyle(source: string): boolean {
  return /(^|\n)\s*export\s+default\s+function/.test(source);
}

/**
 * Extract template + script + a real parse + real scope for one `.najm`
 * document. Returns `null` if the document can't be extracted (e.g. an
 * SFC file with no `<template>` block, or a functional file with no
 * `return { template: ... }`) — callers should treat that as "no
 * diagnostics/completions for this file right now," not a crash.
 */
export function extractDocument(source: string, uri: string): ExtractedNajm | null {
  if (isFunctionalStyle(source)) {
    let parts;
    try {
      parts = extractFunctionalParts(source, uri);
    } catch {
      return null;
    }
    const templateStart = source.indexOf(parts.template, source.indexOf('template'));
    const scriptSource = source.slice(0, parts.retStart);
    let ast: TNode[];
    try {
      ast = parseTemplate(parts.template, uri);
    } catch {
      return null;
    }
    const scope = scanDeclarations(scriptSource, extractParamSource(source));
    scope.componentNames = scanComponentNames(source);
    return {
      style: 'functional',
      template: parts.template,
      templateStart: templateStart >= 0 ? templateStart : 0,
      scriptSource,
      scriptStart: 0,
      ast,
      scope,
    };
  }

  let blocks;
  try {
    blocks = extractBlocks(source, uri);
  } catch {
    return null;
  }
  const templateStart = source.indexOf(blocks.template);
  const scriptStart = blocks.script ? source.indexOf(blocks.script) : 0;
  let ast: TNode[];
  try {
    ast = parseTemplate(blocks.template, uri);
  } catch {
    return null;
  }
  const scope = scanDeclarations(blocks.script, '');
  if (!scope.propsParam) scope.propsParam = 'props';
  scope.componentNames = scanComponentNames(source);
  return {
    style: 'sfc',
    template: blocks.template,
    templateStart: templateStart >= 0 ? templateStart : 0,
    scriptSource: blocks.script,
    scriptStart: scriptStart >= 0 ? scriptStart : 0,
    ast,
    scope,
  };
}

/**
 * Imported component tag names, e.g. `import TodoList from './TodoList.najm'`.
 * Mirrors `codegen.ts`'s `scanComponentImports()`/`processScript()` import
 * detection (component name only — this module has no need for the
 * resolved module URL those functions also compute for codegen's island
 * bookkeeping).
 */
function scanComponentNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+["'](\.[^"']+\.najm)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]);
  return names;
}
