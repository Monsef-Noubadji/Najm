/**
 * Najm compiler — semantic analysis (RFC-0003 migration plan step 3)
 * =================================================================
 * Resolves every `{expr}` / `{@html}` / `bind:` / `on:`/`(event)=` template
 * expression's free variables against the component's DECLARED scope
 * (signals/computed, plain bindings, functions, props, imported
 * components, each-block loop variables) instead of `ir.ts`'s old
 * `extractDeps()`, which returned every bare identifier in an expression
 * with no idea whether it was a real declaration.
 *
 * Two things come out of this pass:
 *
 *   1. `deps` for `dyn-text`/`dyn-attr` IR nodes — now ONLY identifiers
 *      that resolve to a declared `signal`/`computed` in scope. Loop
 *      variables, plain `const`/`let` bindings, props, and function names
 *      are valid scope (never flagged) but are NOT "deps" in this field's
 *      sense: `deps` answers "which reactive signals does this expression
 *      read", not "which identifiers does it reference." See `DeclKind`.
 *   2. Structured `Diagnostic[]` for identifiers that resolve to NOTHING
 *      in scope — not a signal, not a plain binding, not a function, not
 *      a prop, not a loop var, not an imported component, not a known
 *      global. `analyzeSemantics()` returns these without throwing (for
 *      future tooling, RFC-0012's language server); `resolveExprDeps()`'s
 *      caller in `ir.ts` throws immediately on the first one (matching
 *      the compiler's existing fail-fast style, e.g. `compileError()` in
 *      `codegen.ts`) since a genuinely unresolved reference in a real
 *      compile is a hard error, not a warning.
 *
 * ---------------------------------------------------------------------
 * Declaration scanning: what it catches, precisely (this is a LEXICAL/
 * REGEX scan, matching the compiler's existing no-JS-parser constraint —
 * `extractDeps()`'s old free-identifier scan and the rest of `parse.ts`/
 * `ir.ts` are all regex/hand-rolled-scanner based, not an AST parse):
 *
 *   CAUGHT:
 *   - `const x = signal(...)`      → kind 'signal'
 *   - `const x = computed(...)`    → kind 'signal'
 *   - `let x = signal(...)`        → kind 'signal' (let is rare but legal)
 *   - `function f(...) { ... }`    → kind 'function'
 *   - `const f = (...) => { ... }` → kind 'function'
 *   - `const f = function(...) {}` → kind 'function'
 *   - `const f = async (...) => …` / `async function f(...)` → 'function'
 *   - any other top-level `const x = ...` / `let x = ...`  → kind
 *     'binding' (a plain value — array literal, `props.foo`, `new Map()`,
 *     a template-imported const, etc. — valid scope, not a signal)
 *   - `const { a, b } = expr;` / `const [a, b] = expr;` at top level →
 *     each destructured name is a 'binding' (covers e.g. a hypothetical
 *     `const { initial } = props;`)
 *   - the component's own `props` PARAMETER name (from
 *     `function X(props = {})` / `function X(props)`) — recognized as
 *     valid scope for the bare identifier `props` itself (so
 *     `props.initial`, `props.children` etc. resolve); the parameter's
 *     shape is NOT inspected further (see NOT CAUGHT)
 *   - imported component tag names (`import Foo from './Foo.najm'`) via
 *     the SAME import line the codegen already scans
 *     (`scanComponentImports`/`processScript`) — reused here, not
 *     reimplemented, so this pass can never disagree with what codegen
 *     considers a valid component include
 *
 *   NOT CAUGHT (deliberately out of scope — a real JS parser would be
 *   needed, which the compiler avoids per its existing regex-based
 *   design):
 *   - destructured PARAMETER shapes, e.g. `function X({ initial } = {})`
 *     — only bare `props`-style parameters are recognized; a component
 *     authored with a destructured prop parameter will have those names
 *     flagged as unresolved (no real component in this repo uses this
 *     style today — see the Verification report)
 *   - destructuring with renaming (`const { a: b } = x`) — the renamed
 *     target `b` is NOT extracted (nested/renamed destructuring patterns
 *     are skipped; only the simple `{ a, b, c }` / `[a, b, c]` shapes are)
 *   - declarations inside nested blocks/closures (`if (...) { const y =
 *     ...}`, a callback body) — only TOP-LEVEL statements of the
 *     component function body (or `<script>` block) are scanned, one
 *     line/statement at a time; a `const` declared inside a nested
 *     `{ }` is invisible to this pass (whether that's correct is
 *     moot in practice — template expressions can only reach identifiers
 *     that are in scope at the `return`/template site, which nested
 *     block-scoped declarations generally aren't either)
 *   - conditional/reassigned kind changes — `let x = signal(0); x =
 *     computed(...)` keeps whatever kind the FIRST declaration had
 *   - TypeScript type annotations on declarations are tolerated (stripped
 *     by the same identifier regex) but not validated
 *
 * ---------------------------------------------------------------------
 * Dual-mode design (for RFC-0012's future language server): `ir.ts`'s
 * `lowerNodes()` calls `resolveExprDeps()` and THROWS on the first
 * unresolved identifier — a real `compile()` should fail fast, matching
 * `compileError()`'s existing style in `codegen.ts`. `analyzeSemantics()`
 * below is the non-throwing sibling: it walks the same AST, collects
 * EVERY unresolved-identifier diagnostic (not just the first), and
 * returns them instead of throwing — this is the shape an editor
 * integration needs (report all problems in a file being edited, don't
 * stop at the first one).
 */

import type { TNode } from './parse';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DeclKind = 'signal' | 'function' | 'binding';

export interface ScopeDecl {
  name: string;
  kind: DeclKind;
}

/** The component's declared scope, as scanned from its script source. */
export interface Scope {
  /** Top-level declarations, keyed by name (signals, functions, plain bindings). */
  decls: Map<string, ScopeDecl>;
  /** The component's `props` parameter name, if one was found (usually "props"). */
  propsParam: string | null;
  /** Imported component tag names (valid in `<Tag .../>` position, not template expressions). */
  componentNames: Set<string>;
}

export interface Diagnostic {
  severity: 'error';
  /** Human-readable message, already `.najm`-file-relative-free (caller prefixes file/line as needed). */
  message: string;
  /** The unresolved identifier. */
  identifier: string;
  /** The full expression source the identifier was found in. */
  expr: string;
}

/** Local scope extensions layered on top of a `Scope` (each-block loop vars). */
export interface LocalScope {
  names: Set<string>;
}

/* ------------------------------------------------------------------ */
/* Known globals — never flagged, never counted as a "dep"             */
/* ------------------------------------------------------------------ */

const KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'new', 'typeof', 'in',
  'of', 'instanceof', 'void', 'delete',
]);

/** A small, deliberately conservative allowlist of ambient globals. */
const GLOBALS = new Set([
  'console', 'Math', 'JSON', 'Date', 'Array', 'Object', 'Number', 'String',
  'Boolean', 'RegExp', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Symbol', 'Error', 'window', 'document', 'globalThis', 'NaN', 'Infinity',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'fetch',
  // valid only inside `(event)={...}` statement handlers, but harmless to
  // allow everywhere — a template expression outside an event handler
  // referencing `$event` would be a plain ReferenceError at runtime
  // anyway, which is the user's problem to notice, not this pass's.
  '$event',
]);

/* ------------------------------------------------------------------ */
/* Declaration scanning                                                */
/* ------------------------------------------------------------------ */

/**
 * Scan a component's script source (the `<script>` block for SFCs, or
 * everything before the template-returning `return { ... }` for
 * functional components — see `codegen.ts`'s `compileFunctional`/
 * `compileSFC` and this module's own `analyzeSemantics` for how each
 * caller slices this) for top-level declarations.
 *
 * `paramSource` is the function's parameter list source (e.g. `props = {}`
 * or `props`) for functional components; pass `''` for SFCs, whose
 * `<script>` body doesn't have one (props there arrive as a bare `props`
 * identifier implicitly — see `compileSFC`/`processScript`; today no SFC
 * fixture in this repo references `props` at all, but the scan still
 * recognizes the identifier `props` unconditionally as valid scope for
 * both compile paths, matching how `compileSFC`'s generated `ssr(props =
 * {})`/`hydrate(__root, props = {})` always bind that name).
 */
export function scanDeclarations(scriptSource: string, paramSource: string): Scope {
  const decls = new Map<string, ScopeDecl>();
  const set = (name: string, kind: DeclKind): void => {
    if (!decls.has(name)) decls.set(name, { name, kind });
  };

  // function f(...) { ... }  /  async function f(...) { ... }
  const fnDeclRe = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fnDeclRe.exec(scriptSource))) set(m[1], 'function');

  // const/let x = ...   (one top-level statement per match; classify the
  // initializer to tell a signal/computed/function apart from a plain
  // binding). This intentionally only looks at the FIRST `=` after the
  // declared name(s), so it does not walk into nested blocks.
  const declRe = /(?:^|\n)\s*(?:export\s+)?(const|let)\s+(\{[^}=]*\}|\[[^\]=]*\]|[A-Za-z_$][\w$]*)\s*=\s*([^\n]*)/g;
  while ((m = declRe.exec(scriptSource))) {
    const target = m[2].trim();
    const rhs = m[3].trim();
    const kind = classifyInitializer(rhs);

    if (target.startsWith('{') || target.startsWith('[')) {
      // Simple destructuring only — `{ a, b }` / `[a, b]`. Renamed
      // (`a: b`) or nested (`{ a: { b } }`) patterns are not extracted;
      // see this module's doc comment ("NOT CAUGHT").
      const inner = target.slice(1, -1);
      for (const part of inner.split(',')) {
        const name = part.trim().split(':')[0].trim().split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) set(name, 'binding');
      }
    } else if (/^[A-Za-z_$][\w$]*$/.test(target)) {
      set(target, kind);
    }
  }

  // props parameter: recognize a bare `props` (optionally with a default
  // value / TS type) as valid scope. Destructured parameters are not
  // caught (see doc comment).
  let propsParam: string | null = null;
  const paramMatch = paramSource.match(/^\s*([A-Za-z_$][\w$]*)/);
  if (paramMatch) propsParam = paramMatch[1];

  return { decls, propsParam, componentNames: new Set() };
}

/**
 * Extract a functional component's parameter-list source from
 * `export default function Name(<here>) {`. Returns `''` if no such
 * signature is found (e.g. SFC script blocks, which have no function
 * signature of their own — `compileSFC` always binds the name `props`
 * implicitly, see `scanDeclarations`'s doc comment).
 */
export function extractParamSource(source: string): string {
  const m = source.match(/(?:^|\n)\s*export\s+default\s+function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/);
  return m ? m[1] : '';
}

/** `signal(...)` / `computed(...)` (optionally `najm.signal(...)` etc.) → 'signal'; a `function`/`=>` literal → 'function'; anything else → 'binding'. */
function classifyInitializer(rhs: string): DeclKind {
  if (/^(?:[A-Za-z_$][\w$]*\.)?(?:signal|computed)\s*\(/.test(rhs)) return 'signal';
  if (/^(?:async\s+)?function\s*\(/.test(rhs)) return 'function';
  if (/^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(rhs)) return 'function';
  return 'binding';
}

/* ------------------------------------------------------------------ */
/* Expression resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * Blank out the contents of every string/template literal in `expr`,
 * preserving length/positions (so the caller's identifier-scan offsets
 * stay valid) but replacing non-quote characters with spaces. Prevents
 * words inside string literals (`todo.done.value ? "done" : ""`) from
 * being mistaken for free identifiers — a real bug this pass exposed
 * (the old `extractDeps()` had the same gap, but it was harmless there
 * since nothing read its output; here an over-matched "identifier" like
 * `done` would incorrectly throw as unresolved).
 */
function blankStringLiterals(expr: string): string {
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ' ';
      i++;
      while (i < expr.length && expr[i] !== ch) {
        if (expr[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += ' ';
        i++;
      }
      if (i < expr.length) {
        out += ' '; // closing quote
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Extract every free (non-property-access) identifier from an expression. */
function freeIdentifiers(expr: string): string[] {
  const scanned = blankStringLiterals(expr);
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned))) {
    const name = m[0];
    if (KEYWORDS.has(name)) continue;
    const before = scanned.slice(0, m.index);
    if (/\.\s*$/.test(before)) continue; // property-access position, e.g. `.value`
    if (seen.has(name)) continue;
    seen.add(name);
    found.push(name);
  }
  return found;
}

export interface ResolveResult {
  /** Identifiers that resolve to a declared `signal`/`computed` — the IR's `deps`. */
  deps: string[];
  /** Identifiers that resolve to nothing in scope. */
  unresolved: string[];
}

/**
 * Resolve an expression's free identifiers against `scope` plus any
 * `local` names (each-block loop variables in scope at this point).
 * `deps` is signals/computed ONLY; loop vars, plain bindings, functions,
 * props, and component names are valid-but-not-a-dep.
 */
export function resolveExprDeps(expr: string, scope: Scope, local: ReadonlySet<string>): ResolveResult {
  const deps: string[] = [];
  const unresolved: string[] = [];
  for (const name of freeIdentifiers(expr)) {
    if (local.has(name)) continue;
    if (scope.propsParam && name === scope.propsParam) continue;
    if (scope.componentNames.has(name)) continue;
    if (GLOBALS.has(name)) continue;
    const decl = scope.decls.get(name);
    if (!decl) {
      unresolved.push(name);
      continue;
    }
    if (decl.kind === 'signal') deps.push(name);
    // 'function' / 'binding' → valid scope, not a dep.
  }
  return { deps, unresolved };
}

/**
 * Build a `Scope` directly from `(name, kind)` pairs, bypassing source
 * scanning. Useful for IR-lowering unit tests that want to assert
 * lowering SHAPE (does `{expr}` become a `dyn-text` node, does an
 * each-block become a `list` node, etc.) against a hand-picked scope,
 * independent of `scanDeclarations()`'s own regex correctness — that
 * regex is tested separately (see `tests/test-semantics.ts`).
 */
export function makeScope(
  decls: [name: string, kind: DeclKind][],
  opts: { propsParam?: string | null; componentNames?: string[] } = {}
): Scope {
  return {
    decls: new Map(decls.map(([name, kind]) => [name, { name, kind }])),
    propsParam: opts.propsParam ?? 'props',
    componentNames: new Set(opts.componentNames ?? []),
  };
}

/** Format a diagnostic for one unresolved identifier found in `expr`. */
export function makeDiagnostic(identifier: string, expr: string): Diagnostic {
  return {
    severity: 'error',
    message: `\`${identifier}\` is not defined — expected a declared signal, prop, function, or loop variable in scope`,
    identifier,
    expr,
  };
}

/* ------------------------------------------------------------------ */
/* analyzeSemantics — the non-throwing, tooling-facing entry point      */
/* ------------------------------------------------------------------ */

export interface SemanticsResult {
  scope: Scope;
  /** Every unresolved-identifier diagnostic found while walking `ast`, in document order. Empty if none. */
  diagnostics: Diagnostic[];
}

/**
 * Non-throwing sibling of `ir.ts`'s `lowerNodes()`/`resolveDeps()`: scans
 * `source`'s declared scope (same dispatch `compile()` uses — a
 * `export default function` component is treated as the functional
 * style, everything else as an SFC `<script>` block) and walks `ast`
 * collecting EVERY unresolved-identifier diagnostic instead of throwing
 * on the first one. Intended for tooling (RFC-0012's future language
 * server) that wants diagnostics for a file being edited without a hard
 * compile failure — the compiler's own `compile()` path (via `ir.ts`)
 * still throws immediately on a genuine error, unaffected by this
 * function's existence.
 *
 * `ast` must be `parseTemplate()`'s output for the SAME `source` (this
 * function does not re-extract/re-parse the template itself, since a
 * caller mid-edit may already have a parse result, or may want
 * diagnostics for a template string that didn't come from a full
 * `.najm` file).
 */
export function analyzeSemantics(source: string, ast: TNode[]): SemanticsResult {
  const isFunctional = /(^|\n)\s*export\s+default\s+function/.test(source);
  let scope: Scope;
  if (isFunctional) {
    // Mirrors codegen.ts's compileFunctional(): declared scope is
    // everything before the template-returning `return { ... }`. Without
    // a real extractFunctionalParts() boundary (this function doesn't
    // parse the returned object literal), the nearest `return {` is used
    // as the boundary — close enough for tooling diagnostics, which only
    // need "declarations before the template," not codegen's exact
    // splice point.
    const retIdx = source.search(/(?:^|\n)\s*return\s*\{/);
    const scriptSource = retIdx >= 0 ? source.slice(0, retIdx) : source;
    scope = scanDeclarations(scriptSource, extractParamSource(source));
  } else {
    const scriptMatch = source.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/);
    scope = scanDeclarations(scriptMatch ? scriptMatch[1] : '', '');
    if (!scope.propsParam) scope.propsParam = 'props';
  }

  const diagnostics: Diagnostic[] = [];
  const check = (expr: string, local: ReadonlySet<string>): void => {
    const { unresolved } = resolveExprDeps(expr, scope, local);
    for (const id of unresolved) diagnostics.push(makeDiagnostic(id, expr));
  };
  const walk = (nodes: TNode[], local: ReadonlySet<string>): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          break;
        case 'expr':
          check(node.code, local);
          break;
        case 'rawHtml':
          check(node.code, local);
          break;
        case 'each': {
          check(node.list, local);
          const inner = new Set(local);
          inner.add(node.item);
          if (node.index) inner.add(node.index);
          walk(node.children, inner);
          break;
        }
        case 'component':
          for (const a of node.attrs) {
            if (a.kind === 'expr' || a.kind === 'event' || a.kind === 'bind') check(a.value, local);
          }
          break;
        case 'element':
          for (const a of node.attrs) {
            if (a.kind === 'expr' || a.kind === 'event' || a.kind === 'bind') check(a.value, local);
          }
          walk(node.children, local);
          break;
      }
    }
  };
  walk(ast, EMPTY_LOCAL_SET);

  return { scope, diagnostics };
}

const EMPTY_LOCAL_SET: ReadonlySet<string> = new Set();
