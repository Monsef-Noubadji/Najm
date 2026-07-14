/**
 * Najm compiler — IR stage (RFC-0003)
 * =================================================================
 * Lowers the parser's TNode[] (parse.ts, unchanged) into a flat-ish
 * IRNode[] tree that every codegen backend (SSR string builder,
 * hydration claim-walk, client create-mode) consumes instead of
 * walking TNode[] directly.
 *
 * The single most important job of this pass is making the
 * static-hoisting DECISION exactly once: a TNode subtree for which
 * `analyzeStatic().static` is true collapses to one `static-html` IR
 * node, carrying its pre-rendered HTML string (via `staticHtml()`).
 * Every backend then just checks `node.kind === 'static-html'` — no
 * backend re-derives "is this static?" itself anymore.
 *
 * This is an ADDITIVE stage: parse.ts is untouched, and hoist.ts's
 * analyzeStatic/staticHtml are the actual implementation this module
 * calls into (not duplicated) — see RFC-0003's migration plan step 1,
 * which explicitly keeps hoist.ts's exports rather than inlining them.
 *
 * IR nodes intentionally carry a bit more than RFC-0003's schematic
 * shape shows (e.g. `element`'s tag/attrs/children) because the three
 * codegen backends need that information and the alternative — a
 * side-table keyed by node identity — is strictly worse for a tree
 * this small. RFC-0003's shape is the CONTRACT (kind tags + the
 * fields it calls out); the extra fields are backend inputs, not a
 * deviation from it.
 */
import type { TNode, TAttr, TElement, TEach, IslandStrategy } from './parse';
import { analyzeStatic, staticHtml } from './hoist';
import type { Scope, Diagnostic } from './semantics';
import { resolveExprDeps, makeDiagnostic } from './semantics';

/* ------------------------------------------------------------------ */
/* IR node shape                                                       */
/* ------------------------------------------------------------------ */

export interface IRStaticHtml {
  kind: 'static-html';
  html: string;
  /**
   * True when this node is a bare run of static TEXT with no wrapping
   * element (e.g. the "Todos " in `<h2>Todos <span>...</span></h2>`).
   * The claim cursor's `staticSubtree()` only ever claims an Element (it
   * returns `Element`, built for cloneNode-style adoption of a whole
   * tag); a text-only static-html node must instead claim via the
   * cursor's `text()` method, or hydration throws. Losing this
   * distinction during the IR migration (routing every static node
   * through `staticSubtree()` regardless of whether it wraps a tag) was
   * a real bug caught live: `<h2>Todos <span>...</span></h2>`'s leading
   * text node has no element to claim, and `staticSubtree()` failed
   * loudly and correctly on it.
   */
  isText: boolean;
}
export interface IRDynText {
  kind: 'dyn-text';
  expr: string;
  deps: string[];
}
export interface IRRawHtml {
  kind: 'raw-html';
  expr: string;
}
export interface IRDynAttr {
  kind: 'dyn-attr';
  name: string;
  expr: string;
  deps: string[];
}
export interface IREvent {
  kind: 'event';
  name: string;
  handler: string;
  isStatement: boolean;
}
export interface IRTwoWayBind {
  kind: 'two-way-bind';
  property: 'value' | 'checked';
  signal: string;
}
/** A static attribute, kept as its own IR shape (not folded into element). */
export interface IRStaticAttr {
  kind: 'static-attr';
  name: string;
  value: string;
}
export type IRAttr = IRStaticAttr | IRDynAttr | IREvent | IRTwoWayBind;

/**
 * A dynamic element — one whose subtree contains SOMETHING other than
 * static-html (a dynamic attribute/event/bind on itself, or a dynamic
 * descendant). Purely static elements never reach this shape; they are
 * lowered to `static-html` instead.
 */
export interface IRElement {
  kind: 'element';
  tag: string;
  attrs: IRAttr[];
  children: IRNode[];
}
export interface IRList {
  kind: 'list';
  itemVar: string;
  indexVar: string | null;
  listExpr: string;
  body: IRNode[];
}
export interface IRInclude {
  kind: 'include';
  component: string;
  /**
   * Raw attrs, not yet reduced to a props object literal: codegen still
   * owns genProps()'s validation (on:/bind: rejected on components) and
   * its exact string-literal-vs-expression formatting, so the IR passes
   * the source attrs through rather than pre-encoding them. RFC-0003's
   * schematic `props: Record<string, string>` shape is realized at the
   * point genProps() actually builds that object, in codegen.
   */
  attrs: TAttr[];
  island: boolean;
  /**
   * Set iff island is true — which directive marked it (`client:load` vs
   * `client:visible`). Threaded through so codegen can emit the right
   * hydration strategy onto the `<najm-island>` wrapper without
   * re-deriving it from attrs.
   */
  islandStrategy: IslandStrategy | null;
}

export type IRNode =
  | IRStaticHtml
  | IRDynText
  | IRRawHtml
  | IRElement
  | IRList
  | IRInclude;

/* ------------------------------------------------------------------ */
/* Lowering: TNode[] -> IRNode[]                                       */
/* ------------------------------------------------------------------ */

/**
 * Real dependency resolution (RFC-0003 migration plan step 3): replaces
 * the old coarse free-identifier scan with `semantics.ts`'s scope-aware
 * `resolveExprDeps()`. `deps` is now ONLY identifiers that resolve to a
 * declared signal/computed in `scope` (plus whatever each-block loop
 * variables are in `local` at this point in the lowering) — see
 * `semantics.ts`'s module doc comment for exactly what counts as a
 * "dep" vs. valid-but-not-a-dep scope (props, functions, plain
 * bindings, loop vars) vs. unresolved (flagged/thrown).
 *
 * An unresolved identifier throws immediately — this pass runs as part
 * of a real `compile()`, and the compiler's existing style
 * (`compileError()` in codegen.ts) is to fail fast on a genuine error
 * rather than emit broken code. `analyzeSemantics()` (semantics.ts) is
 * the non-throwing sibling entry point for tooling that wants
 * diagnostics without a hard compile failure.
 */
function resolveDeps(expr: string, scope: Scope, local: ReadonlySet<string>, file: string): string[] {
  const { deps, unresolved } = resolveExprDeps(expr, scope, local);
  if (unresolved.length) {
    const d = makeDiagnostic(unresolved[0], expr);
    throw new Error(`[najm] ${file}: ${d.message} (in \`${expr}\`)`);
  }
  return deps;
}

const EMPTY_LOCAL: ReadonlySet<string> = new Set();

/**
 * Lower a full node list (template root, element children, each body).
 * `scope` is the component's declared scope (see `semantics.ts`); `local`
 * is the set of each-block loop variables in scope at this point (empty
 * at the template root — extended only for the children of a `{#each}`,
 * see `lowerEach`).
 */
export function lowerNodes(nodes: TNode[], scope: Scope, local: ReadonlySet<string> = EMPTY_LOCAL, file = ''): IRNode[] {
  const out: IRNode[] = [];
  for (const node of nodes) {
    out.push(...lowerNode(node, scope, local, file));
  }
  return out;
}

/**
 * Lower a single TNode. Returns an array because a fully-static node
 * collapses to (at most) one `static-html` IR node, but adjacent
 * static-html siblings are also merged here so a run of static text/
 * elements becomes ONE static-html IR node — matching the existing
 * hoisting behavior where static SIBLINGS still each get their own
 * `staticSubtree()` claim per top-level static node (hoist.ts classifies
 * per-node, not per-run), so in practice this returns exactly one
 * element for every input node; the array shape just keeps the
 * merge-adjacent door open without changing today's output.
 */
function lowerNode(node: TNode, scope: Scope, local: ReadonlySet<string>, file: string): IRNode[] {
  // Bare text is checked BEFORE the generic static collapse: a text node
  // is always analyzeStatic().static === true, but it must lower with
  // isText: true so codegen claims it via the cursor's text() method,
  // not staticSubtree() (which claims an Element and fails on a text
  // node — see IRStaticHtml.isText's doc comment for the bug this fixes).
  if (node.type === 'text') {
    return [{ kind: 'static-html', html: node.value, isText: true }];
  }

  if (analyzeStatic(node).static) {
    return [{ kind: 'static-html', html: staticHtml(node), isText: false }];
  }

  switch (node.type) {
    case 'expr':
      return [{ kind: 'dyn-text', expr: node.code, deps: resolveDeps(node.code, scope, local, file) }];

    case 'rawHtml':
      return [{ kind: 'raw-html', expr: node.code }];

    case 'each':
      return [lowerEach(node, scope, local, file)];

    case 'component':
      return [lowerComponent(node)];

    case 'element':
      return [lowerElement(node, scope, local, file)];
  }
}

function lowerAttr(a: TAttr, scope: Scope, local: ReadonlySet<string>, file: string): IRAttr {
  switch (a.kind) {
    case 'static':
      return { kind: 'static-attr', name: a.name, value: a.value };
    case 'expr':
      return { kind: 'dyn-attr', name: a.name, expr: a.value, deps: resolveDeps(a.value, scope, local, file) };
    case 'event':
      // Event handlers are resolved for diagnostics (an unresolved
      // handler reference is still a real compile error) but are not a
      // `deps`-bearing IR kind per RFC-0003's schema — resolveDeps()'s
      // return value is discarded, only its throw-on-unresolved matters.
      resolveDeps(a.value, scope, local, file);
      return { kind: 'event', name: a.name, handler: a.value, isStatement: !!a.stmt };
    case 'bind':
      // codegen still validates that `property` is 'value'|'checked' and
      // raises compileError() (which needs ctx/file info this pass
      // doesn't have) — lowering stays total by passing the name through
      // even when invalid, exactly as `a.name` arrived from the parser.
      resolveDeps(a.value, scope, local, file);
      return { kind: 'two-way-bind', property: a.name as 'value' | 'checked', signal: a.value };
    case 'island':
      // Handled by lowerComponent before attrs are mapped; unreachable
      // for element attrs (parser rejects client:load on non-components).
      throw new Error('[najm] internal: island attr reached lowerAttr()');
  }
}

function lowerElement(node: TElement, scope: Scope, local: ReadonlySet<string>, file: string): IRElement {
  return {
    kind: 'element',
    tag: node.tag,
    attrs: node.attrs.map((a) => lowerAttr(a, scope, local, file)),
    children: lowerNodes(node.children, scope, local, file),
  };
}

function lowerEach(node: TEach, scope: Scope, local: ReadonlySet<string>, file: string): IRList {
  // The list expression itself is resolved against the OUTER scope (the
  // loop variables it's about to introduce aren't in scope for it) —
  // resolveDeps()'s return value is unused (no IR field carries "deps of
  // the list expression" per RFC-0003's schema) but its throw-on-
  // unresolved still applies, e.g. `{#each doesNotExist as x}`.
  resolveDeps(node.list, scope, local, file);

  // itemVar/indexVar are only in scope INSIDE this each-block's children,
  // not outside it — extend `local` for the recursive lowerNodes() call
  // only, never mutate/leak it to siblings.
  const inner = new Set(local);
  inner.add(node.item);
  if (node.index) inner.add(node.index);
  return {
    kind: 'list',
    itemVar: node.item,
    indexVar: node.index,
    listExpr: node.list,
    body: lowerNodes(node.children, scope, inner, file),
  };
}

function lowerComponent(node: Extract<TNode, { type: 'component' }>): IRInclude {
  return {
    kind: 'include',
    component: node.name,
    attrs: node.attrs,
    island: node.island,
    islandStrategy: node.islandStrategy,
  };
}
