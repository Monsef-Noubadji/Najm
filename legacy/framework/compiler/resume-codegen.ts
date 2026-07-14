/**
 * Resumable compiler — v1.0 Phase 3.1 PROTOTYPE
 * =================================================================
 * A SEPARATE, DELIBERATELY SMALLER codegen path from codegen.ts,
 * triggered only by an explicit `client:resume` marker (as opposed to
 * `client:load`) on a component include. Beta's compiler and runtime
 * are completely untouched by this file — resumability is additive
 * and opt-in, never a fallback or a default.
 *
 * SUPPORTED TEMPLATE SUBSET (intentionally restricted — this is a
 * mechanism proof, not a claim that every Beta template feature has
 * been ported): text, `{expr}` reading only top-level signals, and
 * `(event)={statement}` bindings whose statement is a single signal
 * mutation. This is enough to compile a real Counter end-to-end
 * through serialize → bootload → lazy-resume → mutate, which is the
 * whole mechanism; each-blocks/components/bind: inside a resumable
 * component are explicitly rejected with an actionable error rather
 * than silently miscompiled.
 *
 * OUTPUT SHAPE (the actual architectural difference from Beta):
 *
 *   export function ssr(props) {
 *     const graph = { signals: {} };
 *     const count = signal(props.start ?? 0);
 *     $registerSignal(graph, "count", count);
 *     return `<div data-mono-resume="${escapeAttr($serialize(graph))}">
 *              <button data-q-on-click="/Counter.mono#onClick_count">
 *                Count: ${count.peek()}
 *              </button>
 *            </div>`;
 *   }
 *
 *   // a MODULE-SCOPE export, reachable by dynamic import — NOT a
 *   // closure captured at render time. This is what the bootloader's
 *   // QRL resolves to; it receives the resumed signal as DATA.
 *   export function onClick_count(event, state) {
 *     const count = state.signal("count");
 *     count.value++;
 *   }
 *
 * Note ssr() is the ONLY export a resumable component needs — there is
 * no hydrate()/closure-based mount step at all, which is the entire
 * point: nothing runs on the client until a real interaction occurs.
 */
import { parseTemplate } from './parse';
import type { TNode, TAttr } from './parse';
import type { CompileOptions } from './codegen';

const RESUME_RUNTIME_IMPORT = `import {
  signal as $signal, get as $get, escapeAttr as $escAttr,
} from 'mono/core';
import {
  registerResumableSignal as $registerSignal, serializeGraph as $serialize,
} from 'mono/core/resume';`;

interface ResumeCtx {
  file: string;
  handlers: string[]; // generated module-scope handler function sources
  handlerCount: number;
}

function fail(ctx: ResumeCtx, msg: string): never {
  throw new Error(`[mono:resume] ${ctx.file}: ${msg}`);
}

/**
 * Compile a `client:resume` component. Only top-level `const x = signal(...)`
 * declarations in the script are tracked into the serialization graph —
 * this prototype does not attempt general closure analysis, which is
 * the real research problem a production resumability compiler (Qwik's
 * Optimizer) solves with a full scope analyzer. Declaring that honestly
 * here rather than pretending to solve it is the point of scoping this
 * as a prototype.
 */
/**
 * Trigger: a file-level marker, `<script resumable>`, distinct from
 * how a PARENT includes the component. Resumability is a property of
 * how a component itself compiles (no hydrate() closure exists at
 * all), not of the call site — conflating the two would let one parent
 * request `client:resume` on a component that was compiled assuming
 * closures exist, which cannot work. One file, one compilation target.
 */
export function isResumableSource(source: string): boolean {
  return /<script\s+resumable(?:\s[^>]*)?>/.test(source);
}

export function compileResumable(source: string, opts: CompileOptions): { code: string } {
  const scriptMatch = source.match(/<script\s+resumable(?:\s[^>]*)?>([\s\S]*?)<\/script>/);
  const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/);
  if (!templateMatch) throw new Error(`[mono:resume] ${opts.id}: missing <template> block`);

  const signalDecls = extractTopLevelSignals(scriptMatch?.[1] ?? '', opts.id);
  const ast = parseTemplate(templateMatch[1], opts.id);

  const ctx: ResumeCtx = { file: opts.id, handlers: [], handlerCount: 0 };
  const componentTag = moduleTag(opts.id);

  const ssrBody: string[] = [];
  ssrBody.push('  const __graph = { signals: {} };');
  for (const [name, init] of signalDecls) {
    ssrBody.push(`  const ${name} = $signal(${init});`);
    ssrBody.push(`  $registerSignal(__graph, ${JSON.stringify(name)}, ${name});`);
  }
  ssrBody.push('  let __html = "";');

  emitSsr(ast, ctx, ssrBody, signalDecls, componentTag, true);

  const code = `${RESUME_RUNTIME_IMPORT}

// ---- resumable render: NO hydrate() export — nothing runs client-side
// until a real user interaction resolves a QRL (see bootloader.ts) ----
export function ssr(props = {}) {
${ssrBody.join('\n')}
  return __html;
}

${ctx.handlers.join('\n\n')}
`;
  return { code };
}

/** `/src/components/Counter.mono` — used as the QRL chunk URL and handler prefix. */
function moduleTag(id: string): string {
  return id.replace(/\\/g, '/').replace(/^.*\/(src\/.*)$/, '/$1');
}

/** Find `const name = signal(initExpr);` at the top level of the script block. */
function extractTopLevelSignals(script: string, file: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*signal\(([^;]*)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) out.push([m[1], m[2].trim()]);
  return out;
}

function emitSsr(
  nodes: TNode[],
  ctx: ResumeCtx,
  out: string[],
  signals: Array<[string, string]>,
  tag: string,
  isRoot: boolean
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(`  __html += ${JSON.stringify(node.value)};`);
        continue;

      case 'expr': {
        const name = node.code.trim();
        if (!signals.some(([n]) => n === name)) {
          fail(ctx, `{${node.code}} — resumable templates may only interpolate a top-level signal by name in this prototype`);
        }
        out.push(`  __html += $get(${name});`);
        continue;
      }

      case 'each':
      case 'component':
      case 'rawHtml':
        fail(ctx, `${node.type === 'each' ? '{#each}' : node.type === 'rawHtml' ? '{@html}' : `<${(node as any).name}/>`} is not supported inside a client:resume component in this prototype — restricted to text/{signal}/(event) bindings`);

      case 'element': {
        out.push(`  __html += ${JSON.stringify(`<${node.tag}`)};`);
        for (const attr of node.attrs) {
          emitAttr(attr, ctx, out, signals, tag);
        }
        if (isRoot) {
          // The graph payload rides the ROOT element so the bootloader
          // can find it by walking up from any interacted-with node.
          // $serialize() already returns a JSON STRING — it must be
          // HTML-ATTRIBUTE-escaped for embedding (quotes → &quot;), not
          // JSON.stringify'd again (that would double-encode it and
          // leave literal quotes that break out of the attribute).
          out.push(`  __html += ' data-mono-resume="' + $escAttr($serialize(__graph)) + '"';`);
        }
        out.push(`  __html += ">";`);
        emitSsr(node.children, ctx, out, signals, tag, false);
        out.push(`  __html += ${JSON.stringify(`</${node.tag}>`)};`);
        continue;
      }
    }
  }
}

function emitAttr(
  attr: TAttr,
  ctx: ResumeCtx,
  out: string[],
  signals: Array<[string, string]>,
  tag: string
): void {
  if (attr.kind === 'static') {
    out.push(`  __html += ${JSON.stringify(` ${attr.name}="${attr.value}"`)};`);
    return;
  }
  if (attr.kind !== 'event') {
    fail(ctx, `attribute "${attr.name}" (${attr.kind}) is not supported inside client:resume in this prototype`);
  }
  if (!attr.stmt) {
    fail(ctx, `(${attr.name})={...} must be a statement in this prototype (on:${attr.name}={fn} references are not supported)`);
  }

  // Only single signal mutations of the exact shape `name.value OP= expr`
  // or `name.value++`/`--` are recognized — enough to prove the mechanism
  // (a real resumability compiler needs full closure/scope analysis to
  // support arbitrary handler bodies; that is out of scope here).
  const m = attr.value
    .trim()
    .match(/^([A-Za-z_$][\w$]*)\.value\s*(\+\+|--|(?:[+\-*/]?=)\s*(.+))$/);
  if (!m || !signals.some(([n]) => n === m[1])) {
    fail(
      ctx,
      `(${attr.name})={${attr.value}} — this prototype only resumes single-signal ` +
        `mutations of the form "name.value++" / "name.value += expr" (name must be a top-level signal)`
    );
  }
  const [, sigName, op] = m;
  const symbol = `${sanitizeIdent(sigName)}_${attr.name}_${ctx.handlerCount++}`;
  const mutation =
    op === '++' || op === '--' ? `sig.value${op}` : `sig.value ${op}`;

  ctx.handlers.push(
    `export function ${symbol}(event, state) {\n` +
      `  const sig = state.signal(${JSON.stringify(sigName)});\n` +
      `  ${mutation};\n` +
      `}`
  );
  out.push(
    `  __html += ${JSON.stringify(` data-q-on-${attr.name}="${tag}#${symbol}"`)};`
  );
}

function sanitizeIdent(s: string): string {
  return s.replace(/[^A-Za-z0-9_$]/g, '_');
}
