/**
 * Hydration engine — Phase 3
 * =================================================================
 * Najm does not re-render on the client to "check" the server's work
 * (that is what VDOM hydration does, and it is why you pay for your
 * HTML twice elsewhere). Instead, the compiler emits a CLAIM WALK:
 * because the SSR string and the hydrate function are generated from
 * the *same template AST*, the client already knows the exact shape
 * of the server HTML and simply walks it, adopting nodes and
 * attaching effects/listeners where the template was dynamic.
 *
 * The server leaves three kinds of breadcrumb comments so the walk
 * stays deterministic where content length varies:
 *
 *   <!--#-->text<!--/-->   a dynamic text expression
 *   <!--[--> ... <!--]-->  a region with a variable number of nodes
 *                          (each-blocks)
 */
import { effect } from './signals';

function fail(msg: string): never {
  throw new Error(
    `[najm hydrate] ${msg} — server HTML and client template are out of sync`
  );
}

function describe(n: Node): string {
  if (n.nodeType === 1) return `<${(n as Element).tagName.toLowerCase()}>`;
  if (n.nodeType === 3) return `text ${JSON.stringify((n as Text).data.slice(0, 24))}`;
  if (n.nodeType === 8) return `<!--${(n as Comment).data}-->`;
  return `node(type=${n.nodeType})`;
}

export interface ClaimCursor {
  element(tag: string): Element;
  text(): Text;
  dynText(): Text;
  block(): [Comment, Comment];
  staticSubtree(): Element;
  enter(el: Element): void;
  exit(): void;
}

/**
 * A depth-first cursor over already-parsed server DOM. Every generated
 * hydrate() drives one of these in template order.
 */
export function claim(root: Element): ClaimCursor {
  let cursor: Node | null = root.firstChild;
  const stack: (Node | null)[] = [];

  const take = (what: string): Node => {
    if (!cursor) fail(`expected ${what} but ran out of nodes`);
    const n = cursor;
    cursor = n.nextSibling;
    return n;
  };

  const isComment = (n: Node, data: string): boolean =>
    n.nodeType === 8 && (n as Comment).data === data;

  return {
    element(tag: string): Element {
      const n = take(`<${tag}>`);
      if (n.nodeType !== 1 || (n as Element).tagName.toLowerCase() !== tag.toLowerCase()) {
        fail(`expected <${tag}>, found ${describe(n)}`);
      }
      return n as Element;
    },

    text(): Text {
      const n = take('a text node');
      if (n.nodeType !== 3) fail(`expected a text node, found ${describe(n)}`);
      return n as Text;
    },

    /** Claim `<!--#-->text<!--/-->`; returns the text node to bind. */
    dynText(): Text {
      const open = take('dynamic-text marker <!--#-->');
      if (!isComment(open, '#')) fail(`expected <!--#-->, found ${describe(open)}`);
      let t: Text;
      if (cursor && cursor.nodeType === 3) {
        t = take('dynamic text') as Text;
      } else {
        // The expression rendered to '' on the server, so the browser
        // parsed no text node between the markers — materialize one.
        t = document.createTextNode('');
        open.parentNode!.insertBefore(t, cursor);
      }
      const close = take('dynamic-text marker <!--/-->');
      if (!isComment(close, '/')) fail(`expected <!--/-->, found ${describe(close)}`);
      return t;
    },

    /** Claim a `<!--[--> ... <!--]-->` region, skipping its contents. */
    block(): [Comment, Comment] {
      const start = take('block marker <!--[-->');
      if (!isComment(start, '[')) fail(`expected <!--[-->, found ${describe(start)}`);
      let depth = 1;
      while (cursor) {
        const n = take('block contents');
        if (isComment(n, '[')) depth++;
        else if (isComment(n, ']') && --depth === 0) return [start as Comment, n as Comment];
      }
      fail('unclosed <!--[--> block');
    },

    /**
     * v1.0 AOT hoisting: adopt an entire static subtree's root in ONE
     * step, WITHOUT descending into it. This is the hydration-cost
     * collapse the spec calls for — static children never advance the
     * cursor node-by-node; the compiler simply never emitted calls for
     * them, and the browser's own already-parsed DOM stays untouched
     * beneath this root. There is nothing to bind, so there is nothing
     * to visit.
     */
    staticSubtree(): Element {
      const n = take('a static subtree root');
      if (n.nodeType !== 1) fail(`expected a static element subtree, found ${describe(n)}`);
      return n as Element;
    },

    enter(el: Element): void {
      stack.push(cursor);
      cursor = el.firstChild;
    },

    exit(): void {
      if (!stack.length) fail('exit() without matching enter()');
      cursor = stack.pop() ?? null;
    },
  };
}

/**
 * Reactive list region (compiled from `{#each}`), anchored between two
 * comment markers so it can grow/shrink without disturbing siblings.
 *
 * v0.1 reconciliation is deliberately coarse: tear down the region and
 * rebuild. Correct first, clever later (keyed diffing is on the v0.2
 * roadmap). Two things keep this honest:
 *
 *  - Effects created inside `create()` (row text/attr bindings) are
 *    OWNED by this effect, so the signals runtime disposes them
 *    automatically on every rebuild — no leaks.
 *  - Per-row signals (e.g. a todo's `done`) update row-level effects
 *    directly WITHOUT touching the list signal, so toggling a checkbox
 *    never rebuilds the list. Fine-grained beats keyed diffing when
 *    you don't trigger the diff at all.
 */
/**
 * v1.0 AOT hoisting on the CREATE path: a module-level <template> is
 * parsed ONCE (import-time), and every instantiation clones its content
 * with native cloneNode(true) — the browser's own fastest DOM-construction
 * primitive — instead of a sequence of createElement/setAttribute calls.
 * Used for static subtrees inside {#each} rows and for the top-level
 * fully-static template of components with a single static element.
 */
export function hoistTemplate(html: string): () => Node {
  let tpl: HTMLTemplateElement | null = null;
  return () => {
    if (!tpl) {
      tpl = document.createElement('template');
      tpl.innerHTML = html;
    }
    return tpl.content.firstChild!.cloneNode(true);
  };
}

export function eachBlock<T>(
  start: Comment,
  end: Comment,
  list: () => readonly T[],
  create: (item: T, index: number) => Node
): void {
  effect(() => {
    const items = list(); // read inside the effect → tracked
    for (let n = start.nextSibling; n && n !== end; ) {
      const next: Node | null = n.nextSibling;
      (n as ChildNode).remove();
      n = next as ChildNode | null;
    }
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const item of items) frag.appendChild(create(item, i++));
    end.parentNode!.insertBefore(frag, end);
  });
}
