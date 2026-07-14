# RFC-0003: Compiler Pipeline

- **Status:** Implemented (migration plan steps 1–3 — see Verification)
- **Depends on:** RFC-0001, RFC-0002
- **Formalizes:** `compiler/ir.ts` (the IR stage this RFC specifies),
  `compiler/semantics.ts` (the semantic-analysis stage this RFC
  specifies), and the restructured `compiler/codegen.ts`, which now
  generates all three backends (SSR, hydration, client create-mode) from
  `IRNode[]` instead of walking `compiler/parse.ts`'s `TNode[]` AST
  directly (all implemented and verified — see Verification)

## Summary

The compiler pipeline is:

```text
Lexer/Parser → AST → Semantic Analysis → IR → Optimization → Codegen
```

The current implementation has Parser → AST → Codegen, with static-hoisting
analysis (`hoist.ts`) bolted directly onto codegen. This RFC specifies the
IR stage the architecture review identified as missing, and — critically —
specifies it as an **incremental addition**, not a rewrite: the existing
parser and AST are correct and stay; codegen is restructured to consume an
IR built from that AST instead of walking the AST directly.

The compiler stays TypeScript. Per RFC-0001, a Rust/SWC rewrite is a
performance project for after the AST and IR are stable, not an
architecture decision to make now.

## Motivation

Without an IR, every optimization (static hoisting, future dead-code
elimination, future tree-shaking of unused template branches) has to be
implemented as a bespoke AST walk, coupled to codegen's own traversal
order. `hoist.ts`'s `analyzeStatic()` already shows the pattern: it's a
second, parallel walk of the same AST that codegen also walks, and the two
have to be kept in sync by convention. An IR gives optimizations a single,
stable data structure to operate on, independent of both the parser's
grammar and codegen's output shape — which is also what makes multiple
codegen targets (SSR string builder, client hydration claim-walk, and the
future Web Component target from RFC-0002) tractable without tripling the
optimization logic.

## Design

### Pipeline stages

```text
1. Lexer/Parser   .najm source → TAST (template AST)
                   Unchanged: compiler/parse.ts is correct today.

2. Semantic       Resolve every {expr}/{@html}/bind:/on: expression's
   Analysis       free variables against the component's declared scope
                   (signals, props, imported components). Currently
                   implicit (codegen just emits the expression source
                   verbatim and lets the generated JS's own scope resolve
                   it); this stage makes it explicit so later stages can
                   reason about WHICH signals a node depends on without
                   re-parsing JS expressions themselves.

3. IR             Lower TAST + semantic info into IR nodes (see below).
                   This is the new stage.

4. Optimization    IR → IR transforms. Static hoisting (RFC-0003 formalizes
                   hoist.ts's existing analysis as the first IR pass) plus
                   future passes (dead code elimination for unreachable
                   {#if} branches once RFC-0003 adds them, constant
                   folding) all operate here, uniformly.

5. Codegen         IR → target-specific output. SSR string builder and
                   client hydration claim-walk (both exist today) become
                   two codegen backends over the SAME IR, instead of two
                   AST walks that happen to be kept manually consistent.
```

### IR shape

The IR is a flat, explicit instruction list per component render target,
not a tree — this is what makes optimization passes composable (a pass is
a function `IR[] -> IR[]`, not a tree-rewrite with parent-pointer
bookkeeping):

```ts
type IRNode =
  | { kind: 'static-html'; html: string }                    // hoisted, cloneable
  | { kind: 'dyn-text'; expr: string; deps: string[] }        // deps = free signal names
  | { kind: 'dyn-attr'; name: string; expr: string; deps: string[] }
  | { kind: 'event'; name: string; handler: string; isStatement: boolean }
  | { kind: 'two-way-bind'; property: 'value' | 'checked'; signal: string }
  | { kind: 'list'; itemVar: string; indexVar: string | null; listExpr: string; body: IRNode[] }
  | { kind: 'include'; component: string; props: Record<string, string>; island: boolean }
  | { kind: 'raw-html'; expr: string };                        // {@html}, server-only
```

`deps` on `dyn-text`/`dyn-attr` is what semantic analysis contributes: the
set of signal names an expression reads. The static-hoisting pass is now
exactly "an element whose IR subtree contains no node other than
`static-html`" — a structural check on the IR, not a second AST walk.

### Codegen backends

Two backends ship in v1, both consuming the same IR:

- **SSR backend** — IR → string-concatenation source (what `genSSR` does
  today, restructured to read IR instead of `TNode`).
- **Hydration backend** — IR → claim-walk source (what `genHydrate`/
  `genCreate` do today, restructured the same way).

A third backend — Web Component / Custom Element codegen for RFC-0002's
interop boundary — is added when RFC-0002's open question on shadow-DOM
vs. light-DOM is resolved. The IR is designed so that addition is a new
backend function, not a change to stages 1–4.

## Migration plan (incremental, not a rewrite)

1. Extract `hoist.ts`'s `analyzeStatic`/`staticHtml` logic into an
   IR-lowering pass that runs once, producing `IRNode[]` from the existing
   `TNode[]` AST — the parser is untouched. **Done** — `compiler/ir.ts`,
   `lowerNodes()`.
2. Rewrite `genSSR`/`genHydrate`/`genCreate` to consume `IRNode[]` instead
   of `TNode`, one function at a time, with the existing compiler test
   suite (`tests/test-hoisting.ts`, and any new IR-level tests) as the
   regression gate at each step. **Done** — see Verification.
3. Only after step 2 is complete and tested does semantic analysis (stage
   2) get its own pass, rather than being folded into IR lowering — this
   keeps each step's diff reviewable. **Done** — `compiler/semantics.ts`.
   `scanDeclarations()` scans a component's script source (regex/lexical,
   no JS parser — matching the compiler's existing style) for top-level
   signals/computed, functions, and plain bindings, plus the `props`
   parameter name; `resolveExprDeps()` resolves a template expression's
   free identifiers against that declared scope (extended locally with
   each-block loop variables during lowering) instead of `ir.ts`'s old
   `extractDeps()`, which returned every bare identifier with no
   knowledge of what was actually declared. `lowerNodes()` now takes a
   `scope` parameter and threads it (plus a per-each-block `local` set)
   through the whole lowering recursion, calling the new resolver at
   every `dyn-text`/`dyn-attr`/event/`bind:`/each-list-expression site
   and throwing immediately on a genuinely unresolved identifier — the
   same fail-fast style as `compileError()` in `codegen.ts`.
   `analyzeSemantics(source, ast)` is the non-throwing sibling entry
   point: it returns `{ scope, diagnostics }` without failing the
   compile, for future tooling (RFC-0012) that wants every problem in a
   file, not just the first.

No stage of this migration changes `.najm` file syntax or the generated
runtime call surface (`$get`, `$text`, `$claim`, etc. from
`runtime/index.ts`) — this is purely an internal compiler
restructuring.

## Alternatives considered

- **Skip the IR, keep optimizing the AST directly.** This is the status
  quo and is what the architecture review flagged as the primary compiler
  gap — every new optimization would keep adding a parallel AST walk.
  Rejected.
- **Rewrite the compiler in Rust now, get the IR for free from a more
  serious compiler framework.** Rejected per RFC-0001: this couples an
  architecture decision (needing an IR) to a technology decision (Rust)
  that should be made independently, later, once there's a stable IR to
  port.

## Verification

- **IR stage added** (`compiler/ir.ts`): `lowerNodes(TNode[]): IRNode[]`
  lowers the parser's unchanged `TNode[]` AST into the `IRNode[]` shape
  this RFC specifies (`static-html`, `dyn-text`, `dyn-attr`, `event`,
  `two-way-bind`, `list`, `include`, `raw-html`, plus a `static-attr` kind
  for element attributes that don't fit any of the RFC's dynamic-binding
  shapes). The static-hoisting decision is made exactly once, in this
  pass, by calling `hoist.ts`'s existing `analyzeStatic()`/`staticHtml()`
  (not duplicated — migration plan step 1's explicit requirement) and
  collapsing any subtree where `analyzeStatic().static` is true into one
  `static-html` node. `hoist.ts` itself is unchanged and still exported
  for that reason. **Done.**
- **All three codegen backends migrated to IR** (migration plan step 2):
  `genSSR`, `genHydrate`, `genEachBlock`/`genCreate` in `compiler/codegen.ts`
  now have `IRNode`-typed signatures and switch on IR `kind`, not TNode
  `type`. Both compile paths — `compileSFC()` (legacy SFC) and
  `compileFunctional()` (the default component style) — call
  `lowerNodes()` once and pass the resulting `IRNode[]` to `genSSR`/
  `genHydrate`; `genHydrate`'s each-block handling passes `IRList` nodes
  into `genEachBlock`/`genCreate` the same way. No backend calls
  `analyzeStatic()`/`staticHtml()` directly anymore — each just checks
  `node.kind === 'static-html'`. **Done.**
- **`resume-codegen.ts`**: confirmed absent from the active compile path.
  It exists only at `legacy/framework/compiler/resume-codegen.ts`
  (resumability was archived per RFC-0001's "not resumable in v1"
  decision) and is not imported by `compiler/plugin.ts`'s dispatch or
  anywhere else in the active tree — left untouched, as it is out of
  scope for this migration.
- **Step 3 (semantic analysis as its own pass) is done** (`compiler/
  semantics.ts`). `deps` on `dyn-text`/`dyn-attr` IR nodes is no longer
  `ir.ts`'s old coarse free-identifier scan (`extractDeps`, removed) —
  it is now real scope resolution: `scanDeclarations(scriptSource,
  paramSource)` lexically scans a component's script for top-level
  declarations (regex-based, matching the compiler's existing
  no-JS-parser design — see `semantics.ts`'s doc comment for the exact
  boundary of what it catches: `const`/`let` initializers classified as
  `'signal'` when the initializer is `signal(...)`/`computed(...)`,
  `'function'` for function declarations and arrow/function-expression
  consts, `'binding'` for everything else, plus simple — non-renamed,
  non-nested — destructuring, plus the bare `props` parameter name; NOT
  caught: destructured parameter shapes, renamed destructuring,
  declarations nested inside blocks/closures) and
  `resolveExprDeps(expr, scope, local)` resolves an expression's free
  identifiers against that scope plus whatever each-block loop variables
  are locally in scope. `deps` is now ONLY identifiers that resolve to a
  declared signal/computed — loop variables, props, functions, and plain
  bindings are valid scope but are correctly excluded from `deps`, which
  answers "which signals does this expression read," not "which
  identifiers does it reference."

  `lowerNodes(nodes, scope, local?, file?)` threads scope through the
  full lowering recursion; `lowerEach` extends `local` with `itemVar`/
  `indexVar` for its children only, never leaking them to siblings or
  the outer scope (verified: a loop variable referenced outside the
  each-block that introduced it throws as unresolved — see
  `tests/test-semantics.ts`). An identifier that resolves to nothing —
  not a signal, not a binding, not a function, not a prop, not a loop
  var, not an imported component, not a small allowlisted global
  (`Math`, `console`, `JSON`, `$event`, etc.) — throws immediately at
  compile time, matching `compileError()`'s existing fail-fast style.
  `analyzeSemantics(source, ast): { scope, diagnostics }` is the
  non-throwing sibling for tooling (RFC-0012's future language server):
  it returns every unresolved-identifier `Diagnostic` in a file instead
  of stopping at the first one.

  No codegen backend was changed to READ `deps` for a new optimization
  in this pass (that remains future work, e.g. a dead-code-elimination
  pass) — `genSSR`/`genHydrate`/`genCreate`'s output is confirmed
  byte-identical to before this change: `tests/test-hoisting.ts`'s five
  generated-code assertions and `tests/test-ir.ts`'s twelve lowering
  assertions both pass unchanged (their fixtures were updated only to
  declare the identifiers they reference, e.g. `const count =
  signal(0);`, since those identifiers are now resolved for real instead
  of rubber-stamped — no assertion on generated code was touched). Every
  real `.najm` file in `src/components/` and `src/pages/` (`TodoList.najm`,
  `Crasher.najm`, `about.najm`, `admin/index.najm`,
  `error-boundary-demo.najm`, `greet/[name].najm`, `index.najm`,
  `layout.najm`, `partial-hydration-demo.najm`, `testing.najm`) compiles
  through `compile()` with zero false-positive unresolved-reference
  diagnostics, including patterns that stress this pass specifically:
  `TodoList.najm`'s `{#each todos as todo}` with `todo.done.value ?
  "done" : ""` (a loop-variable member access alongside string literals
  that must NOT be mistaken for free identifiers — an early
  implementation bug this repo's own live build caught, fixed by
  blanking string-literal contents before identifier-scanning) and
  `index.najm`'s `{#each pillars as p, i}` with `{i + 1}` (an index
  variable used in an arithmetic expression, correctly excluded from
  `deps` as local scope, not a signal).
- Public interfaces unchanged: `compiler/plugin.ts`'s Vite plugin and
  `codegen.ts`'s exported `compile(source, opts): { code }` signature are
  byte-identical to before this migration — confirmed by inspection (no
  edits to either function's signature) and by the fact that
  `server/dev.ts` and the Vite pipeline needed zero changes to keep
  working (see the live check below).
- Every existing compiler test (`tests/test-hoisting.ts`'s four cases)
  passes unchanged after the IR migration, with the exact same
  generated-code assertions (no assertion was touched):

  ```text
  ✓ fully static template: hydrate() emits exactly one staticSubtree() claim, no per-node walk
  ✓ mixed template: only the dynamic path is walked; static siblings are hoisted
  ✓ static rows inside {#each}: client create() clones a hoisted template, not createElement per node
  ✓ identical static subtrees dedupe to ONE hoisted template

  hoisting: all 4 tests passed
  ```

- New IR-level unit tests (`tests/test-ir.ts`, 12 cases) assert the
  lowering step directly against `parseTemplate()`'s TAST output,
  independent of any codegen backend — a static element lowers to one
  `static-html` node; `{expr}` lowers to `dyn-text` with correct `deps`;
  `{#each}` lowers to a `list` node (with and without an index var); a
  fully-static subtree nested inside a dynamic parent still collapses to
  one `static-html` node (the hoisting behavior migration plan step 1
  had to preserve); dynamic/static attrs, events (reference vs.
  statement), `bind:`, `{@html}`, and component includes (island vs.
  not) each lower to their specified IR kind:

  ```text
  ✓ a static element lowers to a single static-html IR node
  ✓ a dynamic {expr} lowers to dyn-text with correct deps
  ✓ a dynamic {expr} with multiple free variables collects all deps
  ✓ an {#each} lowers to a list node
  ✓ an {#each} without an index var lowers indexVar to null
  ✓ a fully-static subtree nested inside a dynamic parent still collapses to one static-html node
  ✓ a dynamic attribute lowers to dyn-attr with deps, alongside static attrs
  ✓ an event attribute lowers to an event IR node, statement vs. reference distinguished
  ✓ a bind: attribute lowers to two-way-bind
  ✓ {@html expr} lowers to raw-html
  ✓ a component tag lowers to an include node, island flag threaded through
  ✓ a non-island component include has island: false

  ir: all 12 tests passed
  ```

- New semantic-analysis unit tests (`tests/test-semantics.ts`, 20 cases)
  cover declaration-scanning classification (`signal`/`computed` →
  `'signal'`, function declarations/arrow consts → `'function'`, every
  other `const`/`let` (including simple destructuring) → `'binding'`,
  bare `props` parameter recognition), real `deps` resolution (a
  declared signal resolves to exactly itself; each-block loop variables
  are valid scope but excluded from `deps`, and do not leak outside the
  block that introduces them — verified to throw when they're
  referenced outside it), unresolved-reference throwing (`{doesNotExist}`
  throws with a message naming the identifier), prop/handler/function
  resolution (`props.initial`, a plain `const` derived from `props`,
  `on:click={fn}`/`(click)={fn()}` handler references), the known-globals
  allowlist, and the string-literal-vs-identifier fix
  (`todo.done.value ? "done" : ""` does not treat `done` inside the
  string literals as a free identifier). The last four cases prove the
  dual-mode design directly: `analyzeSemantics()` returns structured
  `Diagnostic[]` for a file with a real error without throwing, returns
  an empty array for a clean file, correctly scopes loop variables while
  still catching a real error elsewhere in the same file, and works
  against both compile styles (functional-component and SFC `<script>`):

  ```text
  semantics: all 20 tests passed
  ```

- `npm test` (full suite: signals, lifecycle, scheduler, hoisting, IR,
  semantics, store/context, router, runtime-boundary, error-boundary,
  partial-hydration, devtools, build, suite-registration — 14 files) is
  100% green; `npx tsc --noEmit` is clean.
- **False-positive regression check**: every real `.najm` file in this
  repo (`src/components/Crasher.najm`, `src/components/TodoList.najm`,
  `src/pages/about.najm`, `src/pages/admin/index.najm`,
  `src/pages/error-boundary-demo.najm`, `src/pages/greet/[name].najm`,
  `src/pages/index.najm`, `src/pages/layout.najm`,
  `src/pages/partial-hydration-demo.najm`, `src/pages/testing.najm` — 10
  files, all of them) was compiled directly through `compile()` and
  produced zero unresolved-reference errors — confirming this pass
  doesn't regress any real, previously-working component.
  `src/components/SafeCrasher.ts` has no `<template>` block (it's a
  plain module wrapping `Crasher.najm` in `withErrorBoundary()`) and so
  is not a semantic-analysis target itself; it's exercised indirectly
  through `error-boundary-demo.najm`, which imports it.
- `npm run build` (the real production build pipeline) still succeeds
  end-to-end against `src/pages/`: 7 routes found (5 static, 2 dynamic),
  `dist/manifest.json` structurally identical to the shape described
  above this RFC's original steps 1–2 verification (same static/dynamic
  split, same single island chunk for `TodoList.najm`) — this pass is
  compile-time analysis only and does not touch route classification.
- End-to-end, verified against a running dev server (`npm run dev`):
  `GET /` (a Beta functional component, `compileFunctional()`'s path,
  with a `client:load` island) returns `200` with correctly hydration-
  marker-fenced HTML (`<!--#-->...<!--/-->` around dynamic text,
  `<!--[-->...<!--]-->` around each-block output) and the island's
  hydration `<script type="module">` tag intact; `GET /about` (the
  legacy SFC path, `compileSFC()`) returns `200` with no islands and no
  script tag, exactly as `about.najm` specifies. Both routes are
  compiled fresh by the Vite dev-server transform on every request, so
  this exercises the full lower-then-codegen path live, not just the
  unit tests. **Done.**

## Open questions

- Should semantic analysis (stage 2) also resolve prop types from a
  component's TypeScript signature, enabling compile-time prop-type
  checking? Deferred — not required for the IR's optimization role.
