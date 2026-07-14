/**
 * Markdown plugin (RFC-0009's proof-of-concept, built for real)
 * =================================================================
 * RFC-0009's Design section sketches, but does not build, a plugin that
 * "recognizes a component importing a .md file, parses it, and lowers
 * the result into IRStaticHtml nodes directly." `transformIR(nodes,
 * scope)` only ever sees the LOWERED IR (post-parse, post-semantic-
 * analysis) — it has no visibility into the original .najm file's
 * import statements, so "importing a .md file" is realized here as a
 * recognizable IR-level convention instead: a template author writes
 *
 *   {@html md('# Heading|Some *markdown* content, on its own line.')}
 *
 * which parse.ts already lowers to a `raw-html` IR node whose `expr` is
 * the literal source text `md('...')` (see ir.ts's `lowerNode` 'rawHtml'
 * case). This plugin recognizes that exact shape — a call to a `md(...)`
 * helper with a single, non-interpolated single-quoted string argument —
 * and replaces the node with an `IRStaticHtml` node carrying the
 * rendered HTML, reusing `IRStaticHtml`'s existing shape (RFC-0003)
 * rather than inventing a Markdown-specific IR node kind, exactly as
 * the RFC's sketch specifies. `md()` itself is never called at
 * runtime — it exists only as syntax this plugin's `transformIR`
 * recognizes and fully replaces at compile time.
 *
 * Single-quoted, not backtick-delimited, and lines separated by `|`, not
 * `\n`: a component's `template:` body is ITSELF a backtick template
 * literal (`compiler/codegen.ts`'s `extractBacktickProp`), which rejects
 * ANY backslash anywhere in its content (not just backtick escapes) and
 * cannot contain a literal, unescaped backtick without terminating
 * early — so neither `md(\`...\`)` nor a `\n`-bearing argument is
 * expressible inside a real component's template today. `markdownToHtml`
 * itself (below) takes real `\n`-separated Markdown and is tested
 * directly against that; only the in-template `md(...)` convention this
 * plugin recognizes is `|`-separated, to stay backslash-free.
 *
 * This is a minimal Markdown-to-HTML converter — headings, paragraphs,
 * bold/italic, links, and lists — sufficient to prove the `NajmPlugin`
 * contract works end-to-end. It is not a CommonMark implementation.
 */
import type { IRNode } from '../ir';
import type { NajmPlugin } from '../plugin-api';

/** Matches `md('...')` with no embedded `'` or `${...}` interpolation. */
const MD_CALL_RE = /^md\('([^']*)'\)$/;

/** Escape raw text before wrapping it in HTML tags. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline spans: `**bold**`, `*italic*`, `[text](href)` — applied after escaping. */
function renderInline(text: string): string {
  let out = escapeText(text);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

/**
 * Minimal block-level Markdown → HTML: ATX headings (`#`..`######`),
 * unordered lists (`- item` / `* item`), and paragraphs. Blank lines
 * separate blocks. Sufficient to prove the contract, not a full parser.
 */
export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join(' ').trim())}</p>`);
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, '').trim())}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();

  return out.join('');
}

/** Recursively replace `{@html md('...')}` raw-html nodes with rendered static-html. */
function transform(nodes: IRNode[]): IRNode[] {
  return nodes.map((node) => {
    if (node.kind === 'raw-html') {
      const m = node.expr.trim().match(MD_CALL_RE);
      if (!m) return node;
      // The in-template convention is `|`-separated lines (see the
      // module doc comment for why: a component's template: literal
      // cannot contain backslashes, so a real `\n` can't appear here).
      const content = m[1].split('|').join('\n');
      return { kind: 'static-html', html: markdownToHtml(content), isText: false };
    }
    if (node.kind === 'element') {
      return { ...node, children: transform(node.children) };
    }
    if (node.kind === 'list') {
      return { ...node, body: transform(node.body) };
    }
    return node;
  });
}

export const markdownPlugin: NajmPlugin = {
  name: 'najm-plugin-markdown',
  transformIR(nodes) {
    return transform(nodes);
  },
};
