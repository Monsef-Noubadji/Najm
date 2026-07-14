/**
 * AOT Static Hoisting — v1.0 Phase 1.1
 * =================================================================
 * WHY THIS IS TYPESCRIPT, NOT RUST/SWC (architectural justification,
 * per the v1.0 spec's own requirement to justify pattern choices):
 *
 * Svelte's AOT win does not come from the implementation language of
 * its compiler — it comes from a compilation TECHNIQUE: walk a CLOSED
 * template grammar once, at build time, and classify every node as
 * static or dynamic before a single byte of client code is generated.
 * Najm's template grammar (parse.ts) is already closed and already
 * fully analyzed into an AST before codegen runs. A Rust/SWC rewrite
 * would relocate that analysis into a different host language without
 * changing what it computes — it buys nothing for THIS optimization,
 * while costing a second toolchain (Cargo, napi-rs/wasm-bindgen, a
 * native build step in every contributor's path) that the existing
 * Vite pipeline doesn't need. Rust becomes worth its cost only when
 * the compiler's bottleneck is host-language throughput on very large
 * ASTs — which a per-component .najm file, by construction, is not.
 * (A native rewrite remains a legitimate v2.0 project; it should get
 * its own spec and its own justification when parse+codegen time is
 * actually measured as the bottleneck, not assumed to be one.)
 *
 * THE TECHNIQUE ITSELF:
 *
 * v0.1/Beta hydration claim-walks EVERY node, static or not — a
 * `__c.element()` / `__c.text()` call per node just to advance a
 * cursor nothing will ever bind to. That is runtime work proportional
 * to template SIZE rather than template DYNAMISM.
 *
 * This pass classifies every element subtree as static or dynamic:
 *
 *   static  — no signal reads, no bindings, no events anywhere in the
 *             subtree. Hoisted to a MODULE-LEVEL template, cloned once
 *             per instance with native cloneNode(true) — the fastest
 *             DOM construction primitive that exists, and exactly
 *             Svelte's + Solid's own technique.
 *   dynamic — contains at least one reactive expression, binding, or
 *             event anywhere in its subtree. Walked and bound as
 *             before, but ONLY as deep as the first dynamic node —
 *             static children of a dynamic parent are still hoisted
 *             and cloned as a unit, not walked node-by-node.
 *
 * The generated hydrate() output for a static subtree becomes ONE
 * claim call (adopt the already-server-rendered root of that subtree)
 * with NO per-child cursor advancement — hydration cost collapses to
 * the number of DYNAMIC bindings in the template, not its total node
 * count. This is the literal meaning of "update paths for dynamic
 * bindings only" from the spec.
 */
import type { TNode, TElement } from './parse';

export interface StaticInfo {
  /** True if this node and its ENTIRE subtree contain no dynamic content. */
  static: boolean;
}

const analysisCache = new WeakMap<TNode, StaticInfo>();

/** Does this node, by itself (not its children), introduce dynamism? */
function nodeIsIntrinsicallyDynamic(node: TNode): boolean {
  switch (node.type) {
    case 'text':
      return false;
    case 'expr':
      return true; // {expr} is always a reactive binding site
    case 'rawHtml':
      return true; // {@html} is server-only and never claim-walked
    case 'each':
      return true; // list regions are inherently dynamic-length
    case 'component':
      return true; // components manage their own reactivity/SSR
    case 'element':
      // Any expr/event/bind attribute makes the ELEMENT ITSELF dynamic
      // (its attributes need per-instance binding), independent of children.
      return node.attrs.some((a) => a.kind === 'expr' || a.kind === 'event' || a.kind === 'bind');
  }
}

/**
 * Classify a node and memoize the result. A node is static iff it is
 * not intrinsically dynamic AND every child (recursively) is static.
 */
export function analyzeStatic(node: TNode): StaticInfo {
  const cached = analysisCache.get(node);
  if (cached) return cached;

  let isStatic = !nodeIsIntrinsicallyDynamic(node);
  if (isStatic && node.type === 'element') {
    for (const child of node.children) {
      if (!analyzeStatic(child).static) {
        isStatic = false;
        break;
      }
    }
  }
  // 'each' and 'component' are already excluded above; 'text'/'expr' have no children.

  const info: StaticInfo = { static: isStatic };
  analysisCache.set(node, info);
  return info;
}

/**
 * Render a fully-static node subtree to a literal HTML string, for
 * embedding in a module-level template (hoisted once, cloned per
 * instance). Callers must have already confirmed `analyzeStatic(node).static`.
 */
export function staticHtml(node: TNode): string {
  switch (node.type) {
    case 'text':
      return escapeStaticText(node.value);
    case 'element': {
      const el = node as TElement;
      let out = `<${el.tag}`;
      for (const a of el.attrs) {
        // Only 'static' attrs reach here — dynamic ones would have
        // made the element dynamic and excluded it from this path.
        out += ` ${a.name}${a.value ? `="${escapeStaticAttr(a.value)}"` : ''}`;
      }
      out += '>';
      if (isVoid(el.tag)) return out;
      for (const child of el.children) out += staticHtml(child);
      return out + `</${el.tag}>`;
    }
    default:
      // Unreachable when static === true, but keeps this function total.
      throw new Error(`[najm] staticHtml() called on a dynamic node (${node.type})`);
  }
}

function escapeStaticText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeStaticAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function isVoid(tag: string): boolean {
  return VOID.has(tag);
}
