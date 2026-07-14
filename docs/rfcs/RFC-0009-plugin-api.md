# RFC-0009: Plugin API

- **Status:** Implemented
- **Depends on:** RFC-0003 (now fully Implemented, including step 3 —
  `compiler/semantics.ts`'s real scope resolution)

## Summary

A plugin registers IR transforms and/or a codegen backend against
`compiler/ir.ts`'s `IRNode[]` and `compiler/semantics.ts`'s `Scope` —
the same two data structures the compiler's own SSR/hydration backends
consume. `najm` and `najm-compiler` do not import a plugin's code;
a plugin imports `najm-compiler`'s exported types and registers itself
with the Vite plugin (`compiler/plugin.ts`) via a config array, matching
Vite's own plugin convention rather than inventing a new one. This RFC
was blocked twice — first on the IR not existing (RFC-0003 steps 1–2),
then on `deps` being a coarse regex approximation instead of real scope
resolution (RFC-0003 step 3) — both are now resolved, so this RFC
specifies the real contract instead of one built on metadata known to be
untrustworthy.

## Motivation

RFC-0001's "everything possible should become a plugin, core stays
small" mandate has had no concrete mechanism until now — Markdown/MDX
support, i18n, image optimization, and any future framework interop
beyond RFC-0002's Web Component boundary all need a way to extend the
compiler without `najm-compiler` growing a dependency on any of them.
What was missing wasn't the desire, it was a data structure worth
building a contract against: an IR transform that reorders or eliminates
nodes based on `deps` needed `deps` to mean "the signals this expression
actually reads," not "every bare identifier in the expression string,
including loop variables and prop names." `compiler/semantics.ts` (RFC-0003
step 3) makes that true — `IRDynText`/`IRDynAttr.deps` is now populated by
`resolveExprDeps()`, which resolves against the component's real
`Scope` (declared signals/computed, functions, props, imported
components, each-block loop variables), verified with zero false
positives against every real `.najm` file in this repo.

## Design

### What a plugin registers

```ts
interface NajmPlugin {
  name: string;
  /** Runs after IR lowering (compiler/ir.ts's lowerNodes()), before codegen.
   *  Receives the SAME Scope semantic analysis produced — deps on every
   *  IRDynText/IRDynAttr node are real signal names, not approximations. */
  transformIR?(nodes: IRNode[], scope: Scope): IRNode[];
  /** An additional codegen backend (RFC-0003's "third backend" — Web
   *  Component target, or a plugin-specific one, e.g. a static-analysis
   *  linter backend that never emits runtime code at all). */
  codegen?(nodes: IRNode[], scope: Scope): { code: string } | null;
}
```

`transformIR` receiving `scope` (not just `nodes`) is the concrete
payoff of RFC-0003 step 3 existing: a plugin can ask "does this
expression depend on signal X" via `node.deps.includes('X')` and trust
the answer, rather than re-deriving it (which would mean either
duplicating `compiler/semantics.ts` inside every plugin or accepting
`extractDeps()`'s old free-identifier noise, where a loop variable named
the same as a real signal elsewhere in the file would produce a false
dependency edge).

### Where plugins attach: the Vite plugin config array, not a new mechanism

```ts
// compiler/plugin.ts, extended (not replaced)
export function najm(opts?: { plugins?: NajmPlugin[] }): Plugin
```

`compiler/plugin.ts`'s existing `najm()` Vite plugin factory gains one
optional field. This mirrors Vite's OWN plugin convention (an array of
plugin objects with named hooks) deliberately — a Najm user already
configuring Vite doesn't learn a second registration pattern. `najm()`'s
`transform()` hook (unchanged for the non-plugin path) runs
`compile()` as it does today; when `opts.plugins` is non-empty, it runs
each plugin's `transformIR` in array order after `lowerNodes()`/
`analyzeSemantics()` produce `(nodes, scope)`, before handing the
(possibly-transformed) `nodes` to the existing SSR/hydration codegen
backends. A plugin's `codegen` hook, if present, runs as an ADDITIONAL
output (e.g., emitting a `.d.ts` or a linter report alongside the normal
compiled module), not a replacement for the compiler's own SSR/hydration
backends — RFC-0003 is explicit that those two backends are the
compiler's own contract; a plugin does not get to intercept or replace
them, only add alongside.

**Implementation note — the seam inside `compile()`:** `CompileOptions`
gains `plugins?: NajmPlugin[]`. Both `compileFunctional()` and
`compileSFC()` already compute `ir` from `lowerNodes()` right before
handing it to `genSSR`/`genHydrate`; the change at each call site is
exactly `const ir = lowerNodes(...)` → `let ir = lowerNodes(...)` plus
one guarded line, `if (opts.plugins?.length) ir = runPlugins(ir, scope,
opts);`. `runPlugins()` (new, in `codegen.ts`) is the only place that
iterates `opts.plugins` — it runs every `transformIR` in array order
(each plugin sees the previous plugin's output), then runs every
`codegen` hook against the final `ir`. When `opts.plugins` is
absent/empty, `runPlugins()` is never called at all — the compile path
is byte-identical to before this RFC's code existed, not just
behaviorally equivalent (verified explicitly, see Verification).

**Judgment call — where does a plugin's `codegen()` output go?** Vite's
`transform()` hook returns exactly one code string per module, and this
RFC is explicit a plugin's codegen backend is ADDITIONAL output, never a
replacement for the compiled module's own SSR/hydrate exports. There is
no single obvious file/module destination for a generic "additional
backend" (it could be a lint report, a `.d.ts`, a Web Component target,
...), and wiring a virtual-module system into Vite's module graph for
that is speculative machinery no concrete use case has asked for. The
implementation therefore takes the simplest honest option for v1:
`CompileOptions` gains `onPluginCodegen?(pluginName, result): void`,
which `runPlugins()` invokes once per plugin `codegen()` result;
`compiler/plugin.ts`'s `najm()` factory accepts the same callback and
threads it straight into `compile()`. The caller decides what
"additional output" means for their build (write a side-file, log it,
feed a lint report) — `najm()` itself never writes files or emits Vite
assets on a plugin's behalf. Revisit only if a real multi-consumer use
case shows this callback is insufficient — consistent with this RFC's
existing anti-speculation stance on ordering/trust (see Open questions).

### What `najm` and `najm-compiler` do NOT know about plugins

Neither package imports a plugin, has a plugin registry, or has any
runtime awareness that plugins exist — `NajmPlugin` is a TYPE
`najm-compiler` exports (for a plugin author to implement against), not
a base class or a required import. `compiler/plugin.ts`'s `najm()` factory
is the ONLY place plugin objects are ever consumed, and it does so
generically (iterate the array, call each hook if present) with zero
per-plugin special-casing. This is what keeps RFC-0001's small-core
promise real: a Najm app that registers zero plugins pays zero cost
(the `opts.plugins` iteration is an empty-array no-op), and `najm`'s
own `runtime/` boundary (RFC-0002's import gate,
`tests/test-runtime-boundary.ts`) is completely unaffected — plugins are
a `compiler/`-side concept only, never a `runtime/` one.

### First real plugin as proof: Markdown (built)

Built at `compiler/plugins/markdown.ts` (`markdownPlugin`) to validate
the design has enough surface. It registers a `transformIR` that
recognizes a convention and lowers rendered Markdown into `IRStaticHtml`
nodes directly — reusing `IRStaticHtml`'s existing shape (RFC-0003)
rather than inventing a Markdown-specific IR node kind, since rendered
Markdown IS static HTML from the compiler's perspective.

The originally-sketched convention ("a component importing a `.md`
file") needed one real adjustment once actually built:
`transformIR(nodes, scope)` only ever sees the LOWERED IR — it has no
visibility into the original `.najm` file's import statements, since
`compile()` doesn't thread source-level import information that deep.
The implemented convention instead recognizes an IR-level shape a
template author writes directly:

```najm
{@html md('# Heading|Some *markdown* content, on its own line.')}
```

`parse.ts` (untouched) already lowers `{@html expr}` to a `raw-html` IR
node whose `expr` is the literal source text `md('...')`; the plugin
matches that exact shape and replaces the node with `IRStaticHtml`.
`md()` is never called at runtime — it exists only as syntax the
plugin's `transformIR` recognizes and fully replaces at compile time.

One more real constraint surfaced during implementation, also not
foreseeable from the sketch alone: `compiler/codegen.ts`'s
`extractBacktickProp()` (which extracts a functional component's
backtick-delimited `template:` body) rejects ANY backslash anywhere
inside that literal's content, and a literal unescaped backtick would
terminate the template early — both pre-existing, unrelated-to-this-RFC
constraints of Beta's functional-component extraction. That rules out
both a backtick-delimited argument (the sketch's original
`md(...)`-wraps-a-template-literal shape) and a backslash-n-bearing
single-quoted argument. The implemented plugin uses a single-quoted
argument with `|` as the line separator instead — documented in
`compiler/plugins/markdown.ts`'s module doc comment. `markdownToHtml()`
itself (the actual Markdown → HTML conversion: ATX headings, paragraphs,
bold/italic, links, unordered lists) takes ordinary `\n`-separated
Markdown and is tested directly against that; only the in-template
`md(...)` convention is `|`-separated, to stay backslash-free.

This is a minimal converter, not a CommonMark implementation — sufficient
to prove the `NajmPlugin` contract works end-to-end, which it does (see
Verification): a real heading in Markdown source becomes a real
`<h1>...</h1>` substring in the generated SSR output, having passed
through the exact same `transformIR(nodes, scope)` seam any other plugin
uses.

### What this RFC does NOT add

- No plugin marketplace/registry infrastructure — a plugin is an npm
  package exporting a `NajmPlugin`-shaped object, installed and wired
  into `najm()`'s config like any other Vite plugin dependency.
- No sandboxing/permission model for what a plugin's `transformIR` can
  do to the IR — RFC-0016 (Security Model) is where "should an untrusted
  plugin be able to arbitrarily rewrite another component's output" gets
  a real answer; this RFC's job is the mechanical contract, not its
  trust model.
- No plugin ordering/conflict-resolution beyond "runs in array order" —
  no priority system, no dependency graph between plugins. If two
  plugins' `transformIR` conflict, that's array-order-deterministic but
  unmediated; revisit only if a real multi-plugin conflict surfaces.

## Alternatives considered

- **Plugins operate on the TNode AST (pre-IR) instead of IRNode.**
  Rejected — this would mean a plugin re-deriving the static-hoisting
  decision and dependency resolution RFC-0003 already centralizes, the
  exact duplication problem RFC-0003's own Motivation section describes
  for the pre-IR codebase. Operating on `IRNode[]` (post-lowering,
  post-semantic-analysis) means a plugin gets `deps` and the
  static/dynamic classification for free.
- **A plugin hook that runs during parsing (pre-AST) for custom
  template syntax.** Rejected for v1 — `compiler/parse.ts`'s grammar is
  Najm's own template language (RFC-0003's stage 1, explicitly
  "unchanged" through the IR migration); letting a plugin extend the
  GRAMMAR itself (not just transform the resulting IR) is a much larger
  surface (parser hooks, syntax conflicts between plugins) that no
  concrete use case in the Markdown sketch above actually needs — Markdown
  content becomes static HTML at the IR level, it doesn't need new
  template SYNTAX.

## Verification

- The `deps`-trustworthiness premise this RFC depends on is independently
  verified (RFC-0003's own Verification section, and re-confirmed while
  authoring this RFC): `resolveExprDeps()` resolves against a real
  `Scope`, with each-block loop variables correctly excluded from `deps`
  while still being valid (non-flagged) scope — the exact distinction a
  `transformIR` reordering nodes by dependency would need to get right
  (a loop variable named the same as an unrelated signal must not be
  treated as a dependency edge).
- **Done**: `NajmPlugin`'s type export lives at `compiler/plugin-api.ts`
  (a new file, per the RFC's own suggestion), re-exporting nothing extra
  beyond the `NajmPlugin` interface shown above. `compiler/codegen.ts`'s
  `CompileOptions` gained `plugins?: NajmPlugin[]` and
  `onPluginCodegen?(name, result): void`; a new `runPlugins()` helper is
  the only place either `compileFunctional()` or `compileSFC()` touches
  plugins, called from exactly one guarded line in each
  (`if (opts.plugins?.length) ir = runPlugins(ir, scope, opts);`).
  `compiler/plugin.ts`'s `najm()` factory gained
  `opts?: { plugins?: NajmPlugin[]; onPluginCodegen?(...) }`, threaded
  straight into its `transform()` hook's `compile()` call.
- **Done**: `tests/test-plugin-api.ts` (9 tests, registered in
  `package.json`'s `test` script) proves, against real `compile()` calls
  (not stubs):
  - **Zero-cost/no-op**: a real fixture compiled with `opts.plugins`
    absent produces byte-identical output (`assert.equal`, not just
    `assert.match`) to the same fixture compiled with `opts.plugins: []`.
    Independently re-verified directly against three real files in this
    repo (`src/pages/index.najm`, `src/components/TodoList.najm` — both
    functional — and `src/pages/about.najm`, the legacy SFC path):
    absent-vs-`[]` output is character-for-character identical for all
    three (`a.code === b.code`). Additionally: `compiler/codegen.ts`'s
    diff for this RFC is exactly two lines per compile path
    (`const ir` → `let ir`, plus one guarded conditional call) — the
    non-plugin path is provably unchanged by construction, not merely by
    testing, since `runPlugins()` is never invoked when `opts.plugins` is
    absent/empty.
  - **A minimal `transformIR` plugin actually runs and reaches codegen**:
    a test plugin injects an extra `IRStaticHtml` node; the generated SSR
    output string contains that injected content. A sibling test confirms
    the marker is ABSENT with no plugins registered (rules out a false
    positive from unrelated matching).
  - **Plugin order**: two plugins, each appending a distinct marker,
    registered in both orders (`[A, B]` and `[B, A]`); the generated
    output's marker positions reflect the exact registration order each
    time — proving "array order, full stop" (this RFC's Open Questions
    resolution) is what actually executes.
  - **The Markdown plugin**: `compiler/plugins/markdown.ts`'s
    `markdownPlugin`, exercised through a real `compile()` call on a
    fixture containing `{@html md('# Ship Najm|A **compiler-first**
    framework.')}` — the generated SSR output contains the real rendered
    `<h1>Ship Najm</h1>` and `<strong>compiler-first</strong>`
    substrings, and the `md(...)` call itself is completely absent from
    the output (fully compiled away, never reaches the runtime).
    `markdownToHtml()` is also unit-tested directly against headings,
    paragraphs, bold/italic, links, and lists.
  - **`transformIR` receives the REAL `Scope`, not a stub**: a spy plugin
    asserts `scope.decls.has('count')` and
    `scope.decls.get('count').kind === 'signal'` against a fixture that
    actually declares `const count = signal(0)` — and, more precisely,
    that a REAL `dyn-text` node's `deps` (resolved by
    `compiler/semantics.ts`'s real `resolveExprDeps()`, not an
    approximation) is exactly `['count']` for the expression
    `count.value * 2`, observed from inside a plugin's `transformIR`.
- **Done**: full-suite verification. `npm test` (18 suites, including the
  new `tests/test-plugin-api.ts`) is 100% green — every prior compiler
  suite (`test-hoisting.ts`, `test-ir.ts`, `test-semantics.ts`, and all
  others) is unaffected, and `tests/test-runtime-boundary.ts` passes
  unmodified (RFC-0009's implementation touched zero files under
  `runtime/` — confirmed both by that suite's static import-boundary scan
  passing and by this change set not including any `runtime/` file).
  `npx tsc --noEmit` is clean.
- **Done**: a live check against the real dev server. `npm run dev`
  started against this repo's real `src/pages/`; `GET /` (the real
  homepage, `src/pages/index.najm`, which registers no plugins) returned
  200 with its expected content (`Najm <em class="beta">beta</em>` and
  the `TodoList` island's seed todos present), and `GET /about` (the
  legacy SFC path) also returned 200 — both through `compiler/plugin.ts`'s
  real `najm()` Vite plugin with no `opts` passed, proving the plugin
  seam does not perturb the normal, plugin-free compile path in the real
  dev server, not just in unit tests. No errors in the dev server's
  output during either request. Server was stopped after the check.

No gaps: every action item this RFC listed as outstanding is now built
and verified end-to-end against real fixtures, not stubs — Status is
`Implemented` on that basis.

## Open questions

- Should `codegen` hooks be allowed to depend on OTHER plugins' IR
  transforms having already run (a real ordering dependency, not just
  array position), or is "plugins run in the order they're listed,
  full stop" sufficient for v1? No concrete multi-plugin use case exists
  yet to motivate a more expressive ordering system — deferred until one
  does, consistent with RFC-0001's anti-speculation stance.
- RFC-0016 (Security Model) is explicitly where plugin TRUST gets
  designed — should this RFC's `NajmPlugin` type reserve any fields now
  (e.g. a `trusted: boolean` the loader could check) to avoid a breaking
  change later, or is that itself premature? Leaning toward: no
  reservation now — RFC-0018's Tier system means adding a field to a
  Settling-tier type later is a minor-version change, not a breaking one.
