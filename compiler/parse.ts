/**
 * Najm compiler, stage 1 — Phase 2
 * =================================================================
 * Splits a .najm single-file component into its three blocks and
 * parses the <template> into a small AST. The AST is the contract
 * between the two code generators: the SSR string builder and the
 * client hydration claim-walk are BOTH derived from it, which is the
 * whole trick that makes markerless VDOM-free hydration possible.
 *
 * Template grammar (v0.1):
 *   text .................. literal HTML text
 *   {expr} ................ escaped dynamic text (auto-unwraps signals)
 *   <tag attr="x">......... static attribute
 *   <tag attr={expr}> ..... reactive attribute
 *   <tag on:event={fn}> ... event listener (client only, stripped in SSR)
 *   <tag bind:value={sig}>  two-way binding (value | checked)
 *   <Component prop={x} client:load />   island; without client:load,
 *                                        a zero-JS static include
 *   <Component prop={x} client:visible />  island, hydrated lazily —
 *                                        deferred until the element
 *                                        scrolls into the viewport
 *   {#each list as item}...{/each}
 *   {#each list as item, i}...{/each}
 */

export interface NajmBlocks {
  script: string;
  template: string;
  style: string;
}

export function extractBlocks(source: string, file: string): NajmBlocks {
  const grab = (tag: string): string => {
    const m = source.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`)
    );
    return m ? m[1] : '';
  };
  const template = grab('template');
  if (!template.trim()) {
    throw new Error(`[najm] ${file}: a .najm file needs a <template> block`);
  }
  return { script: grab('script'), template, style: grab('style') };
}

/* ------------------------------------------------------------------ */
/* Template AST                                                        */
/* ------------------------------------------------------------------ */

export type AttrKind = 'static' | 'expr' | 'event' | 'bind' | 'island';

/**
 * Which island directive was authored. `load` hydrates eagerly, as soon
 * as the bootstrap script runs (the original, verified mechanism —
 * unchanged). `visible` defers hydration until the island's element
 * intersects the viewport (RFC-0007 partial hydration).
 */
export type IslandStrategy = 'load' | 'visible';

export interface TAttr {
  kind: AttrKind;
  /** For event/bind, the event/property name (e.g. "click", "value"). */
  name: string;
  /** Static string, or raw JS expression source for dynamic kinds. */
  value: string;
  /**
   * Beta: true for `(click)={...}` Angular-style bindings, whose value
   * is a STATEMENT executed on the event (with `$event` in scope) —
   * versus `on:click={...}`, whose value is a handler REFERENCE.
   */
  stmt?: boolean;
  /** For kind 'island', which directive (`client:load` | `client:visible`) was used. */
  strategy?: IslandStrategy;
}

export interface TText {
  type: 'text';
  value: string;
}
export interface TExpr {
  type: 'expr';
  code: string;
}
/**
 * v1.0 Phase 3.2: raw, UNESCAPED HTML interpolation — `{@html expr}`.
 * Exists for exactly one purpose: layout composition, where a layout
 * embeds a PAGE's already-rendered (trusted, framework-produced) HTML
 * string. Naming follows Svelte's identical primitive precisely because
 * it needs to read as "the dangerous one" at a glance — this is not a
 * general-purpose escape hatch for user content.
 */
export interface TRawHtml {
  type: 'rawHtml';
  code: string;
}
export interface TElement {
  type: 'element';
  tag: string;
  attrs: TAttr[];
  children: TNode[];
}
export interface TComponent {
  type: 'component';
  name: string;
  attrs: TAttr[];
  island: boolean;
  /** Set iff island is true — which directive marked it. */
  islandStrategy: IslandStrategy | null;
}
export interface TEach {
  type: 'each';
  list: string;
  item: string;
  index: string | null;
  children: TNode[];
}
export type TNode = TText | TExpr | TElement | TComponent | TEach | TRawHtml;

/** HTML elements that never have children or a closing tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag);
}

/* ------------------------------------------------------------------ */
/* Parser — a small hand-rolled recursive-descent scanner              */
/* ------------------------------------------------------------------ */

export function parseTemplate(src: string, file: string): TNode[] {
  const p = new Parser(src, file);
  const nodes = p.parseNodes();
  if (!p.eof()) p.fail(`unexpected ${JSON.stringify(p.rest(24))} after template root`);
  return nodes;
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string, private readonly file: string) {}

  /* ---- primitives ---- */

  eof(): boolean {
    return this.pos >= this.src.length;
  }
  rest(n: number): string {
    return this.src.slice(this.pos, this.pos + n);
  }
  private peek(): string {
    return this.src[this.pos] ?? '';
  }
  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }
  private eat(s: string): boolean {
    if (!this.startsWith(s)) return false;
    this.pos += s.length;
    return true;
  }
  private expect(s: string): void {
    if (!this.eat(s)) this.fail(`expected ${JSON.stringify(s)}, found ${JSON.stringify(this.rest(16))}`);
  }
  private skipWs(): void {
    while (/\s/.test(this.peek())) this.pos++;
  }
  private readWhile(re: RegExp): string {
    const start = this.pos;
    while (!this.eof() && re.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  fail(msg: string): never {
    const line = this.src.slice(0, this.pos).split('\n').length;
    throw new Error(`[najm] ${this.file}: template parse error (line ${line} of <template>): ${msg}`);
  }

  /* ---- node dispatch ---- */

  parseNodes(): TNode[] {
    const nodes: TNode[] = [];
    while (!this.eof()) {
      if (this.startsWith('</') || this.startsWith('{/')) break; // caller closes
      if (this.startsWith('<!--')) {
        const end = this.src.indexOf('-->', this.pos);
        if (end < 0) this.fail('unterminated HTML comment');
        this.pos = end + 3;
        continue;
      }
      if (this.startsWith('{#each')) {
        nodes.push(this.parseEach());
      } else if (this.startsWith('{#')) {
        this.fail(`unknown block ${JSON.stringify(this.rest(12))} (v0.1 supports {#each})`);
      } else if (this.startsWith('{@html')) {
        const raw = this.readBraced(); // "@html expr"
        nodes.push({ type: 'rawHtml', code: raw.slice('@html'.length).trim() });
      } else if (this.peek() === '{') {
        nodes.push({ type: 'expr', code: this.readBraced() });
      } else if (this.peek() === '<') {
        nodes.push(this.parseTag());
      } else {
        const text = this.readText();
        // Drop whitespace-only text (JSX-style). Both code generators see
        // the same AST, so server output and client claim-walk stay in
        // lockstep — this is why indentation can't break hydration.
        if (!/^\s*$/.test(text)) nodes.push({ type: 'text', value: text });
      }
    }
    return nodes;
  }

  private readText(): string {
    const start = this.pos;
    while (!this.eof() && this.peek() !== '<' && this.peek() !== '{') this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** Consume `{ ... }` with balanced braces, honoring JS string literals. */
  private readBraced(): string {
    this.expect('{');
    const start = this.pos;
    let depth = 1;
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === '"' || ch === "'" || ch === '`') {
        this.skipString(ch);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const code = this.src.slice(start, this.pos).trim();
          this.pos++;
          if (!code) this.fail('empty { } expression');
          return code;
        }
      }
      this.pos++;
    }
    this.fail('unterminated { expression }');
  }

  private skipString(quote: string): void {
    this.pos++; // opening quote
    while (!this.eof()) {
      const ch = this.src[this.pos];
      this.pos++;
      if (ch === '\\') this.pos++; // escaped char
      else if (ch === quote) return;
    }
    this.fail(`unterminated ${quote}string${quote} in expression`);
  }

  /* ---- blocks ---- */

  private parseEach(): TEach {
    const header = this.readBraced(); // "#each todos as todo" | "... as todo, i"
    const m = header.match(
      /^#each\s+([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?$/
    );
    if (!m) this.fail(`malformed each block: {${header}}`);
    const children = this.parseNodes();
    if (!this.eat('{/each}')) this.fail('expected {/each}');
    return { type: 'each', list: m[1], item: m[2], index: m[3] ?? null, children };
  }

  /* ---- tags ---- */

  private parseTag(): TElement | TComponent {
    this.expect('<');
    const tag = this.readWhile(/[A-Za-z0-9-]/);
    if (!tag) this.fail('expected a tag name after "<"');

    const { attrs, selfClosing } = this.parseAttrs(tag);
    const isComponent = /^[A-Z]/.test(tag);

    if (isComponent) {
      if (!selfClosing) {
        this.fail(`<${tag}> — components must be self-closing in v0.1 (slots are on the roadmap)`);
      }
      const islandAttr = attrs.find((a) => a.kind === 'island');
      const island = !!islandAttr;
      const islandStrategy = islandAttr ? islandAttr.strategy ?? 'load' : null;
      return { type: 'component', name: tag, attrs, island, islandStrategy };
    }

    if (attrs.some((a) => a.kind === 'island')) {
      this.fail(`client:load/client:visible only apply to components, not <${tag}>`);
    }

    if (selfClosing || isVoidElement(tag)) {
      return { type: 'element', tag, attrs, children: [] };
    }

    const children = this.parseNodes();
    this.expect('</');
    const close = this.readWhile(/[A-Za-z0-9-]/);
    if (close !== tag) this.fail(`expected </${tag}> but found </${close}>`);
    this.skipWs();
    this.expect('>');
    return { type: 'element', tag, attrs, children };
  }

  private parseAttrs(tag: string): { attrs: TAttr[]; selfClosing: boolean } {
    const attrs: TAttr[] = [];
    for (;;) {
      this.skipWs();
      if (this.eat('/>')) return { attrs, selfClosing: true };
      if (this.eat('>')) return { attrs, selfClosing: false };
      if (this.eof()) this.fail(`unterminated <${tag}> tag`);

      const name = this.readWhile(/[^\s=/>]/);
      if (!name) this.fail(`could not parse attributes of <${tag}>`);

      let raw: string | null = null;
      let isExpr = false;
      if (this.eat('=')) {
        const ch = this.peek();
        if (ch === '"' || ch === "'") {
          this.pos++;
          const end = this.src.indexOf(ch, this.pos);
          if (end < 0) this.fail(`unterminated attribute value on ${name}`);
          raw = this.src.slice(this.pos, end);
          this.pos = end + 1;
        } else if (ch === '{') {
          raw = this.readBraced();
          isExpr = true;
        } else {
          this.fail(`attribute ${name} must be "quoted" or {braced}`);
        }
      }
      attrs.push(this.classifyAttr(name, raw, isExpr));
    }
  }

  private classifyAttr(name: string, raw: string | null, isExpr: boolean): TAttr {
    // Beta event syntax: (click)={statement}. The statement runs on the
    // event with `$event` bound — Angular semantics, so `(click)={count.value++}`
    // does what it looks like it does.
    const paren = name.match(/^\(([A-Za-z][\w-]*)\)$/);
    if (paren) {
      if (!isExpr || raw == null) this.fail(`(${paren[1]}) needs a {statement} expression`);
      return { kind: 'event', name: paren[1], value: raw, stmt: true };
    }
    if (name.startsWith('on:')) {
      if (!isExpr || raw == null) this.fail(`${name} needs a {handler} expression`);
      return { kind: 'event', name: name.slice(3), value: raw };
    }
    if (name.startsWith('bind:')) {
      if (!isExpr || raw == null) this.fail(`${name} needs a {signal} expression`);
      return { kind: 'bind', name: name.slice(5), value: raw };
    }
    if (name.startsWith('client:')) {
      if (name === 'client:load') {
        return { kind: 'island', name: 'load', value: '', strategy: 'load' };
      }
      if (name === 'client:visible') {
        return { kind: 'island', name: 'visible', value: '', strategy: 'visible' };
      }
      this.fail(`unsupported directive ${name} (v1.0 ships client:load and client:visible; client:idle is on the roadmap)`);
    }
    if (isExpr) return { kind: 'expr', name, value: raw ?? '' };
    // Bare attributes (`disabled`) normalize to empty-string values,
    // which HTML treats as boolean-true.
    return { kind: 'static', name, value: raw ?? '' };
  }
}
