/**
 * Najm language server — completion provider (RFC-0012)
 * =================================================================
 * Two completion contexts, both grounded in real `extractDocument()`
 * data (the same `parseTemplate()`/`analyzeSemantics()` output
 * diagnostics and go-to-definition use — no second grammar):
 *
 *   1. Inside `{...}` / `bind:`/`on:` attribute values: complete from
 *      `scope.decls.keys()` + `scope.propsParam` + whatever each-block
 *      loop variables are in scope AT THE CURSOR POSITION.
 *   2. Inside a tag position (`<|`): complete from `scope.componentNames`
 *      plus the fixed directive set (`client:load`, `client:visible`,
 *      `bind:value`, `bind:checked` — NOT `client:idle`, RFC-0007 doesn't
 *      implement it).
 *
 * Loop-variable-in-scope-at-cursor detection walks the REAL AST
 * (`extractDocument()`'s `doc.ast`, `parseTemplate()`'s actual output)
 * the same way `compiler/ir.ts`'s `lowerEach()` walks it to extend
 * `local` for an each-block's children — reused here for a position
 * lookup instead of lowering. Since `TNode` carries no source positions
 * (RFC-0012's Design section notes this is also true of `Scope` and is
 * deliberate — see `definition.ts`), this module re-derives each node's
 * text span by walking the template source IN THE SAME LEFT-TO-RIGHT
 * ORDER `parseTemplate()` itself parsed it, advancing a cursor through
 * the source as each node's own text is located — this is bookkeeping
 * on top of the real AST's shape, not a second parser.
 */
import type { Position } from 'vscode-languageserver/node';
import { CompletionItemKind } from 'vscode-languageserver/node';
import type { CompletionItem } from 'vscode-languageserver/node';
import type { TNode } from '../compiler/parse';
import { extractDocument } from './extract';
import { positionToOffset } from './positions';

/** RFC-0007's real, current island directive set — client:idle is deliberately excluded (not implemented). */
const ISLAND_DIRECTIVES = ['client:load', 'client:visible'];
/** RFC-0003/parse.ts's currently-supported bind: properties. */
const BIND_DIRECTIVES = ['bind:value', 'bind:checked'];
const TAG_DIRECTIVES = [...ISLAND_DIRECTIVES, ...BIND_DIRECTIVES];

export type CompletionContext = 'expression' | 'tag' | 'none';

/**
 * Classify what's textually immediately before `offset` in `text` (the
 * template portion of the document): are we inside an unclosed `{...}`
 * (an expression / bind: / on: attribute value), or right after `<` (a
 * tag-position completion)? Pure textual lookback, matching the same
 * brace/tag conventions `compiler/parse.ts`'s own scanner recognizes
 * (`{`, `<`) — not a re-implementation of the parser's grammar, just
 * enough lookback to know which of the RFC's two contexts applies.
 */
export function classifyContext(text: string, offset: number): CompletionContext {
  const before = text.slice(0, offset);

  // Walk backwards tracking brace depth to see if we're inside an
  // unclosed `{`. Stop at the first `>` seen at depth 0 — that marks the
  // end of some earlier tag/close-tag/each-close, so any `{`/`}` before
  // it belongs to a already-closed construct and must not leak into this
  // lookback (e.g. a preceding `{/each}`'s `}` must not be mistaken for
  // an unclosed brace around the cursor).
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return 'expression';
      depth--;
    } else if (ch === '>' && depth === 0) {
      break;
    }
  }

  // Not inside `{...}` — check for tag position: the nearest unmatched
  // `<` before the cursor with no intervening `>`.
  const lastLt = before.lastIndexOf('<');
  const lastGt = before.lastIndexOf('>');
  if (lastLt > lastGt) return 'tag';

  return 'none';
}

/**
 * Walk `nodes` (real `parseTemplate()` output) advancing `cursor.pos`
 * through `template` in the same order the parser produced these nodes,
 * collecting the set of each-block loop variables in scope at
 * `targetOffset` (an offset into `template`, NOT the full document).
 * `scanNode` intentionally only re-locates text ranges via
 * `template.indexOf(...)` searches starting from the current cursor —
 * fast and correct because the parser itself is a left-to-right,
 * non-backtracking scanner, so each node's source text appears in the
 * same order in `template` as the AST lists it.
 */
function loopVarsInScopeAt(template: string, nodes: TNode[], targetOffset: number): Set<string> {
  const result = new Set<string>();
  let cursor = 0;

  const advanceTo = (needle: string): number => {
    const idx = template.indexOf(needle, cursor);
    if (idx < 0) return cursor;
    cursor = idx;
    return idx;
  };

  const walk = (list: TNode[], local: Set<string>): void => {
    for (const node of list) {
      if (cursor > targetOffset) return;
      switch (node.type) {
        case 'text':
          advanceTo(node.value);
          cursor += node.value.length;
          break;
        case 'expr':
          advanceTo(node.code);
          cursor += node.code.length;
          break;
        case 'rawHtml':
          advanceTo(node.code);
          cursor += node.code.length;
          break;
        case 'each': {
          const headerStart = advanceTo('{#each');
          const bodyStart = template.indexOf('}', headerStart) + 1;
          const closeIdx = findEachClose(template, bodyStart);
          const inner = new Set(local);
          inner.add(node.item);
          if (node.index) inner.add(node.index);
          // If the target offset falls within this each-block's body
          // span (between its header's closing `}` and its `{/each}`),
          // the loop vars ARE in scope — record them regardless of
          // whether we recurse further (a cursor inside the body but
          // before any child node's own text still counts).
          if (targetOffset >= bodyStart && targetOffset <= closeIdx) {
            for (const v of inner) result.add(v);
          }
          cursor = bodyStart;
          walk(node.children, inner);
          cursor = closeIdx >= 0 ? closeIdx + '{/each}'.length : cursor;
          break;
        }
        case 'component':
        case 'element': {
          const tagNeedle = node.type === 'component' ? `<${node.name}` : `<${node.tag}`;
          advanceTo(tagNeedle);
          if (node.type === 'element') walk(node.children, local);
          break;
        }
      }
    }
  };

  walk(nodes, new Set());
  return result;
}

/** Find the offset of the matching `{/each}` for an each-block body starting at `from`, honoring nesting. */
function findEachClose(template: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < template.length) {
    const nextOpen = template.indexOf('{#each', i);
    const nextClose = template.indexOf('{/each}', i);
    if (nextClose < 0) return template.length;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 6;
      continue;
    }
    depth--;
    if (depth === 0) return nextClose;
    i = nextClose + 7;
  }
  return template.length;
}

/** Completion inside `{...}`/`bind:`/`on:` attribute values: scope.decls + propsParam + in-scope loop vars. */
function expressionCompletions(text: string, offset: number, doc: NonNullable<ReturnType<typeof extractDocument>>): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const decl of doc.scope.decls.values()) {
    items.push({
      label: decl.name,
      kind: decl.kind === 'function' ? CompletionItemKind.Function : CompletionItemKind.Variable,
      detail: decl.kind,
    });
  }
  if (doc.scope.propsParam) {
    items.push({ label: doc.scope.propsParam, kind: CompletionItemKind.Variable, detail: 'props' });
  }

  const templateOffset = offset - doc.templateStart;
  if (templateOffset >= 0 && templateOffset <= doc.template.length) {
    const loopVars = loopVarsInScopeAt(doc.template, doc.ast, templateOffset);
    for (const name of loopVars) {
      items.push({ label: name, kind: CompletionItemKind.Variable, detail: 'each-block loop variable' });
    }
  }
  return items;
}

/** Completion in tag position (`<|`): componentNames + the fixed directive set. */
function tagCompletions(doc: NonNullable<ReturnType<typeof extractDocument>>): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const name of doc.scope.componentNames) {
    items.push({ label: name, kind: CompletionItemKind.Class, detail: 'component' });
  }
  for (const directive of TAG_DIRECTIVES) {
    items.push({ label: directive, kind: CompletionItemKind.Keyword, detail: 'najm directive' });
  }
  return items;
}

/**
 * Compute LSP completion items at `position` in a `.najm` document.
 * Returns `[]` (never throws) if the document can't be extracted or the
 * cursor isn't in either of the RFC's two recognized contexts.
 */
export function getCompletions(uri: string, text: string, position: Position): CompletionItem[] {
  const doc = extractDocument(text, uri);
  if (!doc) return [];

  const offset = positionToOffset(text, position);
  const context = classifyContext(text, offset);

  if (context === 'expression') return expressionCompletions(text, offset, doc);
  if (context === 'tag') return tagCompletions(doc);
  return [];
}

export { TAG_DIRECTIVES };
