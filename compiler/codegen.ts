/**
 * Najm compiler, stage 2 — Phase 2 & 3
 * =================================================================
 * Turns one parsed .najm file into ONE JavaScript module with TWO
 * exports generated from the SAME template AST:
 *
 *   ssr(props): string
 *     Pure string concatenation — the fastest way to render HTML on
 *     a server, full stop. Dynamic text is fenced with <!--#-->/<!--/-->
 *     markers and variable-length regions with <!--[-->/<!--]-->, which
 *     is the breadcrumb trail hydration follows.
 *
 *   hydrate(root, props): void
 *     Re-runs the component's <script> (fresh signals, same props),
 *     then performs a claim-walk over the server-rendered DOM,
 *     attaching one tiny effect per dynamic text/attribute and one
 *     listener per on:event. No rendering, no diffing — adoption.
 *
 * The user's <script> body is inlined into BOTH functions: that is
 * what makes a .najm component an instance factory rather than a
 * singleton, and it is why props must be serializable for islands.
 *
 * Two-way binding (`bind:value={draft}`) is recognized at the AST
 * level (attr kind 'bind') and lowered to:
 *   SSR      →  value="${draft.value}"        (initial paint)
 *   hydrate  →  $bval(el, draft)              (effect + input listener)
 */
import path from 'node:path';
import { extractBlocks, parseTemplate, isVoidElement } from './parse';
import type { TAttr } from './parse';
import { escapeAttr } from '../runtime/escape';
import { lowerNodes } from './ir';
import type { IRNode, IRAttr, IRList } from './ir';
import { scanDeclarations, extractParamSource } from './semantics';
import type { Scope } from './semantics';
import type { NajmPlugin } from './plugin-api';

const RUNTIME = '@monsef-nbj/najm/core';

/** The $-prefixed helper surface both compilers target. */
const HELPER_IMPORT = `import {
  get as $get, escapeHtml as $esc, attr as $attr, registerStyle as $style,
  renderComponent as $comp, renderIsland as $island,
  claim as $claim, eachBlock as $each, hoistTemplate as $hoist,
  bindText as $text, bindAttr as $battr, bindValue as $bval,
  bindChecked as $bchk, listen as $on,
} from ${JSON.stringify(RUNTIME)};`;

export interface CompileOptions {
  /** Absolute filesystem path of the .najm file. */
  id: string;
  /** Vite project root — used to compute root-relative island URLs. */
  root: string;
  /**
   * RFC-0009: optional plugins run after IR lowering, before codegen.
   * Absent/empty is a zero-cost no-op — output is byte-identical to
   * compiling with no `plugins` field at all.
   */
  plugins?: NajmPlugin[];
  /**
   * RFC-0009: sink for plugin `codegen()` hook results (an ADDITIONAL
   * output, never a replacement for the SSR/hydration backends below).
   * `compile()` returns a single `{ code }` string, so a plugin's own
   * codegen output has nowhere else to go — callers that care (e.g.
   * `compiler/plugin.ts`'s `najm()`) pass a callback to observe it.
   */
  onPluginCodegen?(pluginName: string, result: { code: string }): void;
}

/**
 * Run each plugin's `transformIR` in array order (RFC-0009 Open
 * Questions: "plugins run in the order they're listed, full stop") and
 * any `codegen` hooks, reporting their output via `opts.onPluginCodegen`.
 * A no-op when `opts.plugins` is absent/empty — callers skip calling this
 * at all in that case, but it's also safe to call unconditionally.
 */
function runPlugins(nodes: IRNode[], scope: Scope, opts: CompileOptions): IRNode[] {
  let ir = nodes;
  for (const plugin of opts.plugins ?? []) {
    if (plugin.transformIR) ir = plugin.transformIR(ir, scope);
  }
  for (const plugin of opts.plugins ?? []) {
    if (plugin.codegen) {
      const result = plugin.codegen(ir, scope);
      if (result) opts.onPluginCodegen?.(plugin.name, result);
    }
  }
  return ir;
}

/**
 * Beta dispatch: a .najm file is either a Beta FUNCTIONAL component
 * (`export default function … return { template: \`…\` }`) or a legacy
 * v0.1 SFC (`<script>/<template>/<style>` blocks). Both compile against
 * the same runtime, both hydrate the same way — teams migrate file by
 * file, not big-bang.
 */
export function compile(source: string, opts: CompileOptions): { code: string } {
  if (/(^|\n)\s*export\s+default\s+function/.test(source)) {
    return compileFunctional(source, opts);
  }
  return compileSFC(source, opts);
}

function compileSFC(source: string, opts: CompileOptions): { code: string } {
  const blocks = extractBlocks(source, opts.id);
  const ast = parseTemplate(blocks.template, opts.id);
  const script = processScript(blocks.script, opts);

  const ctx = makeGenContext(script.componentSources, opts.id);
  // SFC scripts have no function signature of their own (props arrives
  // implicitly as ssr(props={})/hydrate(__root, props={}), see
  // scanDeclarations's doc comment) — paramSource is '' so only the bare
  // identifier "props" is ever recognized, never a destructured shape.
  const scope = scanDeclarations(blocks.script, '');
  scope.componentNames = new Set(script.componentSources.keys());
  if (!scope.propsParam) scope.propsParam = 'props';
  let ir = lowerNodes(ast, scope, undefined, opts.id);
  if (opts.plugins?.length) ir = runPlugins(ir, scope, opts);

  const ssrEm = new SsrEmitter();
  for (const node of ir) genSSR(node, ssrEm, ctx);

  const hyd: string[] = [];
  for (const node of ir) genHydrate(node, hyd, ctx);

  const style = blocks.style.trim();

  const code = `${script.hoisted.join('\n')}
${HELPER_IMPORT}
${ctx.hoisted().join('\n')}

const __STYLE = ${style ? JSON.stringify(style) : 'null'};

// ---- server render: component → HTML string (async since Beta) -------
export async function ssr(props = {}) {
  if (__STYLE) $style(__STYLE);
${script.body}
  let __html = "";
${ssrEm.code()}
  return __html;
}

// ---- client hydrate: server DOM + fresh signals → live island --------
export function hydrate(__root, props = {}) {
${script.body}
  const __c = $claim(__root);
${hyd.join('\n')}
}
`;
  return { code };
}

/* ------------------------------------------------------------------ */
/* <script> processing                                                 */
/* ------------------------------------------------------------------ */

interface ProcessedScript {
  hoisted: string[];
  body: string;
  componentSources: Map<string, string>;
}

/**
 * Imports must live at module scope, but the rest of the script body is
 * inlined into ssr()/hydrate() so each render gets fresh state. Default
 * imports of .najm files are rewritten to namespace imports (a compiled
 * component is a module with ssr/hydrate exports, not a default export),
 * and we remember their root-relative URLs for island bookkeeping.
 */
function processScript(script: string, opts: CompileOptions): ProcessedScript {
  const hoisted: string[] = [];
  const body: string[] = [];
  const componentSources = new Map<string, string>();

  for (const line of script.split('\n')) {
    if (!/^\s*import\s/.test(line)) {
      body.push(line);
      continue;
    }
    let out = line.trim();
    const m = out.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+(["'])(.+?\.najm)\2/);
    if (m) {
      out = `import * as ${m[1]} from ${JSON.stringify(m[3])};`;
      componentSources.set(m[1], toRootUrl(m[3], opts));
    }
    hoisted.push(out);
  }
  return { hoisted, body: body.join('\n'), componentSources };
}

/** './TodoList.najm' relative to the importer → '/src/components/TodoList.najm'. */
function toRootUrl(spec: string, opts: CompileOptions): string {
  const abs = spec.startsWith('.')
    ? path.resolve(path.dirname(opts.id), spec)
    : path.resolve(opts.root, spec.replace(/^\//, ''));
  return '/' + path.relative(opts.root, abs).split(path.sep).join('/');
}

/* ------------------------------------------------------------------ */
/* Shared generator context                                            */
/* ------------------------------------------------------------------ */

interface GenContext {
  counter: number;
  uid(prefix: string): string;
  componentSources: Map<string, string>;
  file: string;
  /** Registers hoisted static HTML, deduped by content; returns the clone-factory var name. */
  hoistStatic(html: string): string;
  /** Module-level `const $hN = hoistTemplate("...")` declarations collected so far. */
  hoisted(): string[];
}

function makeGenContext(componentSources: Map<string, string>, file: string): GenContext {
  const byHtml = new Map<string, string>();
  const decls: string[] = [];
  let counter = 0;
  return {
    get counter() {
      return counter;
    },
    set counter(v: number) {
      counter = v;
    },
    uid(prefix: string) {
      return `__${prefix}${counter++}`;
    },
    componentSources,
    file,
    hoistStatic(html: string): string {
      const existing = byHtml.get(html);
      if (existing) return existing; // identical static rows share ONE hoisted template
      const name = `__h${byHtml.size}`;
      byHtml.set(html, name);
      decls.push(`const ${name} = $hoist(${JSON.stringify(html)});`);
      return name;
    },
    hoisted(): string[] {
      return decls;
    },
  };
}

function compileError(ctx: GenContext, msg: string): never {
  throw new Error(`[najm] ${ctx.file}: ${msg}`);
}

/** Compile a component tag's attrs into a `{ ... }` props object literal. */
function genProps(attrs: TAttr[], ctx: GenContext, name: string): string {
  const entries: string[] = [];
  for (const a of attrs) {
    if (a.kind === 'island') continue;
    if (a.kind === 'event' || a.kind === 'bind') {
      compileError(ctx, `<${name}>: on:/bind: are not supported on components in v0.1`);
    }
    const key = JSON.stringify(a.name);
    entries.push(a.kind === 'expr' ? `${key}: (${a.value})` : `${key}: ${JSON.stringify(a.value)}`);
  }
  return `{ ${entries.join(', ')} }`;
}

/* ------------------------------------------------------------------ */
/* SSR code generation — HTML as string concatenation                  */
/* ------------------------------------------------------------------ */

type Piece = { lit: string } | { expr: string };

/**
 * Accumulates literal chunks and expressions, merging adjacent literals
 * so the output reads like handwritten string building:
 *   __html += "<li class=\"" + ... ;
 */
class SsrEmitter {
  private stmts: string[] = [];
  private pieces: Piece[] = [];

  lit(s: string): void {
    if (!s) return;
    const last = this.pieces[this.pieces.length - 1];
    if (last && 'lit' in last) last.lit += s;
    else this.pieces.push({ lit: s });
  }
  expr(e: string): void {
    this.pieces.push({ expr: e });
  }
  stmt(s: string): void {
    this.flush();
    this.stmts.push(s);
  }
  private flush(): void {
    if (!this.pieces.length) return;
    const js = this.pieces
      .map((p) => ('lit' in p ? JSON.stringify(p.lit) : p.expr))
      .join(' + ');
    this.stmts.push(`  __html += ${js};`);
    this.pieces = [];
  }
  code(): string {
    this.flush();
    return this.stmts.join('\n');
  }
}

function genSSR(node: IRNode, em: SsrEmitter, ctx: GenContext): void {
  switch (node.kind) {
    case 'static-html':
      em.lit(node.html);
      return;

    case 'dyn-text':
      // Marker-fenced so hydration can find (or materialize) the text node.
      em.lit('<!--#-->');
      em.expr(`$esc($get((${node.expr})))`);
      em.lit('<!--/-->');
      return;

    case 'raw-html':
      // UNESCAPED by design — see TRawHtml's doc comment. No markers:
      // this exists for server-only layout composition, which never
      // hydrates, so there is nothing for a claim-walk to find here.
      em.expr(`$get((${node.expr}))`);
      return;

    case 'list': {
      const l = ctx.uid('l');
      em.lit('<!--[-->');
      em.stmt(`  for (let ${l}i = 0, ${l} = $get((${node.listExpr})); ${l}i < ${l}.length; ${l}i++) {`);
      em.stmt(`    const ${node.itemVar} = ${l}[${l}i];`);
      if (node.indexVar) em.stmt(`    const ${node.indexVar} = ${l}i;`);
      for (const child of node.body) genSSR(child, em, ctx);
      em.stmt('  }');
      em.lit('<!--]-->');
      return;
    }

    case 'include': {
      const src = ctx.componentSources.get(node.component);
      if (!src) {
        compileError(ctx, `<${node.component} /> is not imported from a .najm file in this component's <script>`);
      }
      const props = genProps(node.attrs, ctx, node.component);
      // Component includes are awaited: the SSR pipeline went async in
      // Beta so meta-islands (Vue's async renderToString) can join it.
      // The strategy argument is only emitted for client:visible — a
      // client:load include's generated call is byte-identical to before
      // this directive existed, since 'load' is renderIsland()'s default.
      const islandCall =
        node.islandStrategy === 'visible'
          ? `await $island(${node.component}, ${JSON.stringify(src)}, ${props}, ${JSON.stringify('visible')})`
          : `await $island(${node.component}, ${JSON.stringify(src)}, ${props})`;
      em.expr(node.island ? islandCall : `await $comp(${node.component}, ${props})`);
      return;
    }

    case 'element': {
      em.lit(`<${node.tag}`);
      for (const a of node.attrs) {
        switch (a.kind) {
          case 'static-attr':
            em.lit(` ${a.name}="${escapeAttr(a.value)}"`);
            break;
          case 'dyn-attr':
            em.expr(`$attr(${JSON.stringify(a.name)}, $get((${a.expr})))`);
            break;
          case 'two-way-bind':
            // Initial paint of the bound state; the client half of the
            // binding is attached during hydration.
            if (a.property !== 'value' && a.property !== 'checked') {
              compileError(ctx, `bind:${a.property} is not supported (v0.1: value, checked)`);
            }
            em.expr(`$attr(${JSON.stringify(a.property)}, $get((${a.signal})))`);
            break;
          case 'event':
            break; // events are client-only — this is the "strip the JS" part
        }
      }
      em.lit('>');
      if (isVoidElement(node.tag)) return;
      for (const child of node.children) genSSR(child, em, ctx);
      em.lit(`</${node.tag}>`);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hydration code generation — the claim walk                          */
/* ------------------------------------------------------------------ */

function genHydrate(node: IRNode, out: string[], ctx: GenContext): void {
  switch (node.kind) {
    // v1.0 AOT hoisting: a fully-static subtree is adopted in ONE claim
    // call and never walked. This is the entire optimization — hydration
    // cost drops from O(template size) to O(dynamic bindings). The IR
    // lowering pass already made this decision once; this backend just
    // reads it off the node kind. A bare-text static-html node claims
    // via text() instead — staticSubtree() only ever claims an Element
    // and throws on a text node (see IRStaticHtml.isText's doc comment).
    case 'static-html':
      out.push(node.isText ? '  __c.text();' : '  __c.staticSubtree();');
      return;

    case 'dyn-text':
      out.push(`  $text(__c.dynText(), () => $get((${node.expr})));`);
      return;

    case 'list': {
      const b = ctx.uid('b');
      out.push(`  const [${b}s, ${b}e] = __c.block();`);
      genEachBlock(node, `${b}s`, `${b}e`, out, ctx, '  ');
      return;
    }

    case 'include':
      // Pages compose islands; islands do not nest in v0.1. Pages are
      // never hydrated, so this only ever fires on misuse.
      out.push(
        `  throw new Error(${JSON.stringify(
          `[najm] cannot hydrate <${node.component}/>: components inside islands are not supported in v0.1 — compose islands at the page level`
        )});`
      );
      return;

    case 'raw-html':
      // {@html} exists for server-only layout composition (see
      // TRawHtml's doc comment) and never appears in an island's
      // template in practice; reject explicitly rather than silently
      // mis-claiming the DOM if it ever does.
      out.push(
        `  throw new Error(${JSON.stringify(
          '[najm] {@html} is not supported inside a hydrated island in v1.0 — it is for server-only layout composition'
        )});`
      );
      return;

    case 'element': {
      const interactive = node.attrs.some((a) => a.kind !== 'static-attr');
      const needsVar = interactive || node.children.length > 0;
      const v = needsVar ? ctx.uid('e') : null;
      out.push(`  ${v ? `const ${v} = ` : ''}__c.element(${JSON.stringify(node.tag)});`);
      genElementBindings(node.attrs, v, out, ctx);
      if (node.children.length) {
        out.push(`  __c.enter(${v});`);
        for (const child of node.children) genHydrate(child, out, ctx);
        out.push('  __c.exit();');
      }
      return;
    }
  }
}

/** Shared by hydrate (claimed elements) and create (built elements). */
function genElementBindings(
  attrs: IRAttr[],
  v: string | null,
  out: string[],
  ctx: GenContext
): void {
  for (const a of attrs) {
    switch (a.kind) {
      case 'dyn-attr':
        out.push(`  $battr(${v}, ${JSON.stringify(a.name)}, () => $get((${a.expr})));`);
        break;
      case 'event':
        // (click)={stmt} → wrap the statement in a handler with $event
        // in scope (Angular semantics). on:click={fn} → handler reference.
        out.push(
          a.isStatement
            ? `  $on(${v}, ${JSON.stringify(a.name)}, ($event) => { ${a.handler}; });`
            : `  $on(${v}, ${JSON.stringify(a.name)}, (${a.handler}));`
        );
        break;
      case 'two-way-bind':
        if (a.property === 'value') out.push(`  $bval(${v}, (${a.signal}));`);
        else if (a.property === 'checked') out.push(`  $bchk(${v}, (${a.signal}));`);
        else compileError(ctx, `bind:${a.property} is not supported (v0.1: value, checked)`);
        break;
      case 'static-attr':
        break; // handled by claim()/createElement(), not per-binding
    }
  }
}

/* ------------------------------------------------------------------ */
/* Create-mode generation — CSR for the inside of each-blocks          */
/* ------------------------------------------------------------------ */

/**
 * Each-block rows are (re)built on the client, so their contents compile
 * to plain DOM construction. Row-level bindings become effects owned by
 * the enclosing eachBlock effect — the ownership tree in signals.ts
 * disposes them automatically whenever the region rebuilds.
 */
function genEachBlock(
  node: IRList,
  startVar: string,
  endVar: string,
  out: string[],
  ctx: GenContext,
  indent: string
): void {
  const params = node.indexVar ? `(${node.itemVar}, ${node.indexVar})` : `(${node.itemVar})`;
  const f = ctx.uid('f');
  out.push(`${indent}$each(${startVar}, ${endVar}, () => $get((${node.listExpr})), ${params} => {`);
  out.push(`${indent}  const ${f} = document.createDocumentFragment();`);
  for (const child of node.body) genCreate(child, f, out, ctx, indent + '  ');
  out.push(`${indent}  return ${f};`);
  out.push(`${indent}});`);
}

function genCreate(
  node: IRNode,
  parent: string,
  out: string[],
  ctx: GenContext,
  indent: string
): void {
  switch (node.kind) {
    // v1.0 AOT hoisting on the create path: a static subtree becomes one
    // module-level parsed <template>, cloned per row with native
    // cloneNode(true) instead of createElement/setAttribute calls — the
    // same technique Svelte and Solid use for list-row scaffolding. The
    // IR lowering pass already decided this node is static; this backend
    // just hoists its pre-rendered HTML.
    case 'static-html': {
      const tplVar = ctx.hoistStatic(node.html);
      out.push(`${indent}${parent}.appendChild(${tplVar}());`);
      return;
    }

    case 'dyn-text': {
      const t = ctx.uid('t');
      out.push(`${indent}const ${t} = document.createTextNode("");`);
      out.push(`${indent}$text(${t}, () => $get((${node.expr})));`);
      out.push(`${indent}${parent}.appendChild(${t});`);
      return;
    }

    case 'list': {
      // Nested lists: create the anchor comments ourselves, then recurse.
      const b = ctx.uid('b');
      out.push(`${indent}const ${b}s = document.createComment("[");`);
      out.push(`${indent}const ${b}e = document.createComment("]");`);
      out.push(`${indent}${parent}.appendChild(${b}s); ${parent}.appendChild(${b}e);`);
      genEachBlock(node, `${b}s`, `${b}e`, out, ctx, indent);
      return;
    }

    case 'include':
      out.push(
        `${indent}throw new Error(${JSON.stringify(
          `[najm] cannot render <${node.component}/> inside a client each-block in v0.1`
        )});`
      );
      return;

    case 'raw-html':
      out.push(
        `${indent}throw new Error(${JSON.stringify(
          '[najm] {@html} is not supported inside a client each-block — it is for server-only layout composition'
        )});`
      );
      return;

    case 'element': {
      const v = ctx.uid('e');
      out.push(`${indent}const ${v} = document.createElement(${JSON.stringify(node.tag)});`);
      for (const a of node.attrs) {
        if (a.kind === 'static-attr') {
          out.push(`${indent}${v}.setAttribute(${JSON.stringify(a.name)}, ${JSON.stringify(a.value)});`);
        }
      }
      // Reuse the exact same binding lowering as hydration — same
      // template semantics whether a node was claimed or created.
      const bindings: string[] = [];
      genElementBindings(node.attrs, v, bindings, ctx);
      out.push(...bindings.map((s) => indent + s.trimStart()));
      for (const child of node.children) genCreate(child, v, out, ctx, indent);
      out.push(`${indent}${parent}.appendChild(${v});`);
      return;
    }
  }
}

/* ================================================================== */
/* Beta — the functional component compiler                            */
/* ================================================================== */

/**
 * The Beta authoring model:
 *
 *   export default function Counter(props = {}) {
 *     const count = signal(0);
 *     onMounted(() => console.log('live'));
 *     return { template: `<button (click)={count.value++}>Count: {count.value}</button>` };
 *   }
 *
 * The critical design constraint: the template MUST remain statically
 * analyzable, or "compiler-first" dies and we become a runtime-parsed
 * framework with a runtime-parsed framework's bundle size and startup
 * cost. So the compiler finds the returned object literal, lifts the
 * `template:` backtick out AT BUILD TIME, and splices back:
 *
 *   return {
 *     ssr:     async () => { ...string building... },
 *     hydrate: (__root) => { ...claim walk + bindings... },
 *   };
 *
 * Because the replacement sits in the same lexical position as the
 * original return, the generated code closes over the component's
 * signals and functions naturally — no `this`, no instance proxy, no
 * runtime scope object. The closure IS the instance.
 */
function compileFunctional(source: string, opts: CompileOptions): { code: string } {
  const parts = extractFunctionalParts(source, opts.id);
  const ast = parseTemplate(parts.template, opts.id);
  const componentSources = scanComponentImports(source, opts);
  const ctx = makeGenContext(componentSources, opts.id);
  // Declared scope is scanned from everything before the template's
  // `return` (parts.retStart) — the same boundary compileFunctional
  // already computes to splice the generated view back in below, so
  // this scan sees exactly the signals/functions/bindings a reader of
  // the component would consider "in scope at the template."
  const scope = scanDeclarations(source.slice(0, parts.retStart), extractParamSource(source));
  scope.componentNames = new Set(componentSources.keys());
  let ir = lowerNodes(ast, scope, undefined, opts.id);
  if (opts.plugins?.length) ir = runPlugins(ir, scope, opts);

  const ssrEm = new SsrEmitter();
  for (const node of ir) genSSR(node, ssrEm, ctx);

  const hyd: string[] = [];
  for (const node of ir) genHydrate(node, hyd, ctx);

  const style = parts.style.trim();

  const view = `{
    // compiled by najm — the authored template was statically extracted
    // and replaced by its two build targets (see najm-compiler docs)
    ssr: async () => {
${style ? `      $style(${JSON.stringify(style)});\n` : ''}      let __html = "";
${ssrEm.code()}
      return __html;
    },
    hydrate: (__root) => {
      const __c = $claim(__root);
${hyd.join('\n')}
    },
  }`;

  const code =
    HELPER_IMPORT +
    '\n' +
    ctx.hoisted().join('\n') +
    '\n' +
    source.slice(0, parts.retStart) +
    'return ' +
    view +
    source.slice(parts.objEnd + 1);
  return { code };
}

export interface FunctionalParts {
  /** Index of the `return` keyword of the view-returning statement. */
  retStart: number;
  /** Index of the returned object literal's closing brace. */
  objEnd: number;
  template: string;
  style: string;
}

/**
 * Locate `return { … template: \`…\` … }`. We scan every `return {` and
 * accept the first whose object literal carries a top-level backtick
 * `template` property — helpers returning other objects are skipped.
 *
 * Exported for RFC-0012's language server, which needs the SAME
 * template-extraction boundary `compileFunctional()` uses (not a second,
 * LSP-specific regex) to feed `parseTemplate()` correctly for functional
 * components — see `language-server/extract.ts`.
 */
export function extractFunctionalParts(source: string, file: string): FunctionalParts {
  const re = /return\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const objStart = source.indexOf('{', m.index);
    const objEnd = scanBalancedObject(source, objStart);
    if (objEnd < 0) continue;
    const objSrc = source.slice(objStart, objEnd + 1);
    const template = extractBacktickProp(objSrc, 'template', file);
    if (template == null) continue;
    const style = extractBacktickProp(objSrc, 'style', file) ?? '';
    return { retStart: m.index, objEnd, template, style };
  }
  throw new Error(
    `[najm] ${file}: a functional component must return an inline ` +
      'object literal with a backtick `template` property'
  );
}

/** Balanced-brace scan over JS source (strings, backticks, comments aware). */
function scanBalancedObject(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipJsString(src, i);
      if (i < 0) return -1;
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return -1;
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i);
      if (i < 0) return -1;
      i++;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** From an opening quote/backtick, return the index of its closing mate. */
function skipJsString(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') i++;
    else if (ch === quote) return i;
  }
  return -1;
}

/** Extract a top-level backtick property (`template:` / `style:`) from an object literal. */
function extractBacktickProp(objSrc: string, prop: string, file: string): string | null {
  const m = objSrc.match(new RegExp(`(?:^|[{,\\s])${prop}\\s*:\\s*\``));
  if (!m || m.index == null) return null;
  const open = objSrc.indexOf('`', m.index);
  const close = skipJsString(objSrc, open);
  if (close < 0) throw new Error(`[najm] ${file}: unterminated \`${prop}\` literal`);
  const content = objSrc.slice(open + 1, close);
  if (/\$\{/.test(content)) {
    throw new Error(
      `[najm] ${file}: ${prop} contains \${...} — Najm templates interpolate with ` +
        '{expr}; JS template substitution would defeat static compilation'
    );
  }
  if (content.includes('\\')) {
    throw new Error(`[najm] ${file}: backslash escapes inside ${prop} are not supported in Beta`);
  }
  return content;
}

/**
 * Map template component names to their module URLs. Beta components are
 * DEFAULT exports, so `import TodoList from './TodoList.najm'` needs no
 * rewriting — we only record where each import lives so islands know
 * what the browser should fetch. Works for .najm, .ts, and .tsx targets
 * (the latter two are how React/Vue meta-island adapters arrive).
 */
function scanComponentImports(source: string, opts: CompileOptions): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+["'](\.[^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    map.set(m[1], toRootUrl(m[2], opts));
  }
  return map;
}
