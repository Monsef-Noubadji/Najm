# RFC-0012: Language Server (LSP)

- **Status:** Implemented
- **Depends on:** RFC-0003 (fully Implemented, including step 3's
  `compiler/semantics.ts`), `compiler/parse.ts` (unchanged)

## Summary

`najm-language-server` implements the LSP `textDocument/publishDiagnostics`,
`textDocument/definition`, and `textDocument/completion` requests for
`.najm` files by calling directly into `compiler/parse.ts`'s real parser
and `compiler/semantics.ts`'s `analyzeSemantics()` — the SAME functions
`compile()` uses, not a second LSP-specific grammar or a reimplemented
scope resolver. The architecture review marks this "Critical" priority
and is explicit that it should reuse the real compiler; that reuse is
now concretely possible because `analyzeSemantics()` was designed for
exactly this consumer (its own doc comment: "Intended for tooling
(RFC-0012's future language server) that wants diagnostics for a file
being edited without a hard compile failure").

## Motivation

Before RFC-0003 step 3, "diagnostics" from `compiler/parse.ts` alone
meant syntax errors only — a missing closing tag, a malformed `{#each}`
header. The review's actual ask ("this binding references a signal that
doesn't exist") needs to know what's IN SCOPE, which requires exactly
the declaration-scanning and expression-resolution
`compiler/semantics.ts` now does. Critically, `analyzeSemantics()` was
built with the non-throwing/collect-everything shape an LSP needs
(`SemanticsResult { scope, diagnostics: Diagnostic[] }`, walking the
whole AST and returning every unresolved reference in document order,
never throwing) — DISTINCT from `compile()`'s own fail-fast-on-first-error
behavior, which is correct for a build but wrong for an editor showing
live diagnostics on a file with three separate typos at once.

## Design

### Diagnostics: a direct, un-adapted consumer of `analyzeSemantics()`

```ts
// najm-language-server's core diagnostic provider
import { parseTemplate, extractBlocks } from 'compiler/parse';
import { analyzeSemantics } from 'compiler/semantics';

function getDiagnostics(uri: string, text: string): LspDiagnostic[] {
  const template = /* extract via extractBlocks() for SFC, or the
                       functional-component template-extraction logic
                       compileFunctional() uses, matched by source shape */;
  const ast = parseTemplate(template, uri);
  const { diagnostics } = analyzeSemantics(text, ast);
  return diagnostics.map(toLspDiagnostic); // severity/message/range mapping
}
```

`Diagnostic.identifier` and `Diagnostic.expr` (RFC-0003's real shape,
not a schematic) give enough to compute a `range` by locating `expr`
within `text` and the `identifier`'s offset within `expr` — LSP
diagnostics need a `{ line, character }` range, which `Diagnostic` itself
doesn't carry (it's compiler-internal, working in expression-source
offsets, not file offsets); mapping expression-relative to
document-relative positions is THIS module's job, not a
`compiler/semantics.ts` change — keeping the compiler's diagnostic shape
free of LSP-specific concerns (matching RFC-0001's "don't add
complexity to core for one consumer" instinct, here applied to
`compiler/` rather than `runtime/`).

Two current real gaps to carry over honestly, both inherited directly
from `compiler/semantics.ts`'s documented scanning boundary (RFC-0003):
a component authored with a destructured prop parameter
(`function X({ initial })`) will have `initial` incorrectly flagged as
unresolved by the LSP too, since the underlying scanner doesn't catch
that shape (RFC-0003's Verification section notes no real component in
this repo uses this style today, but an LSP consumer WILL hit this the
first time a user tries it) — same for renamed destructuring
(`{ a: b }`). This RFC does not fix those (that's a `compiler/semantics.ts`
revision, tracked as this RFC's most concrete follow-up, not invented
here) but the LSP must not present them as more confident than they are
— see "Known false positives" below.

### Go-to-definition: `Scope.decls`, already the right data

```ts
function getDefinition(uri: string, text: string, position: Position): Location | null {
  const { scope } = analyzeSemantics(text, ast);
  const identifier = identifierAtPosition(text, position);
  const decl = scope.decls.get(identifier);
  if (!decl) return null;
  // locate `decl.name`'s declaration site in `text` (a second, LSP-side
  // scan for the exact declaration line — Scope doesn't carry source
  // positions today, only names/kinds; see Open Questions)
}
```

`Scope.decls: Map<string, ScopeDecl>` (RFC-0003's real type) already
has everything needed to know go-to-definition is POSSIBLE for a given
identifier (it resolves to a real declaration) — what it lacks is the
declaration's own source position, since `compiler/semantics.ts` was
built to answer "is this resolved" for compile-time correctness, not
"where exactly is this declared" for editor tooling. This RFC's
implementation adds that position-finding as an LSP-side concern
(re-scanning `scriptSource` for the specific declaration line once an
identifier is known to resolve), rather than growing `Scope` itself with
position data every non-LSP consumer of `analyzeSemantics()`
(`compiler/codegen.ts`'s `lowerNodes()` path) would then carry for no
benefit.

### Completion: scope-aware, not grammar-only

Two completion contexts, both grounded in real data already available:

- **Inside `{...}` / `bind:`/`on:` attribute values**: complete from
  `scope.decls.keys()` (signals, functions, bindings) plus
  `scope.propsParam` plus each-block loop variables in scope AT THE
  CURSOR POSITION (requires walking the AST to find which `{#each}`,
  if any, the cursor is textually inside — the same nesting
  `compiler/ir.ts`'s `lowerEach()` already walks recursively, reused
  here for position-lookup instead of lowering).
- **Inside a tag position (`<|`)**: complete from `scope.componentNames`
  (imported components) plus the fixed set of Najm template directives
  (`client:load`, `client:visible` — RFC-0007's real, current set;
  `client:idle` deliberately excluded since it isn't implemented, per
  RFC-0007's own Open Questions) plus `bind:value`/`bind:checked` (the
  two RFC-0003/parse.ts currently supports).

### What this RFC does NOT add

- No custom `.najm` grammar for the LSP separate from
  `compiler/parse.ts` — this is the review's explicit requirement and
  this design has no second grammar anywhere.
- No renaming/refactoring support (`textDocument/rename`) — scope
  resolution alone doesn't guarantee a rename is safe across dynamic
  string-based component includes or computed prop names; deferred as a
  larger, separate design problem, not silently assumed solved by having
  `Scope` available.
- No cross-file project-wide diagnostics (e.g. "this imported component
  doesn't export what you're using") — `analyzeSemantics()` operates on
  ONE file's source; a multi-file project graph is out of scope for this
  RFC's v1 (single-file diagnostics, go-to-definition, completion only).

### Implementation notes (judgment calls this RFC left implicit)

- **Package structure.** `language-server/` is a plain TypeScript source
  directory (`extract.ts`, `positions.ts`, `diagnostics.ts`,
  `definition.ts`, `completion.ts`, `server.ts`), sibling to `compiler/`,
  `runtime/`, `router/`, `server/`, using the ROOT `package.json`'s
  `dependencies` (`vscode-languageserver`, `vscode-languageserver-
  textdocument`) and `node_modules` rather than its own
  `packages/najm-*`-style `package.json`. `packages/` (checked before
  building) is specifically the npm-distribution blueprint layer for
  Najm's own runtime/compiler/router/server — each entry there ships as
  an installable package with its own `dist/`, `exports` map, and
  `tsup` build. The language server is dev/editor tooling consumed by
  spawning `language-server/server.ts` directly (via `tsx`, exposed as
  `npm run lsp`) or, later, RFC-0013's VS Code extension bundling it —
  neither consumer needs it published to npm independently today, so a
  second `package.json`/build step would be packaging ceremony with no
  current consumer, not "actually works and is testable." Revisit if
  RFC-0013 or a future non-VS-Code editor integration needs to `npm
  install` it as a standalone artifact.
- **Extraction-path detection.** `language-server/extract.ts`'s
  `isFunctionalStyle()` uses the EXACT SAME dispatch regex
  `compiler/codegen.ts`'s `compile()` and `compiler/semantics.ts`'s
  `analyzeSemantics()` already use
  (`/(^|\n)\s*export\s+default\s+function/`) — not re-derived, copied
  verbatim so the LSP can never classify a file's style differently than
  the real compiler would. Functional-component extraction reuses
  `compiler/codegen.ts`'s `extractFunctionalParts()` directly (exported
  for this purpose — previously module-private, since it had no
  consumer outside `compileFunctional()` before this RFC); SFC
  extraction reuses `compiler/parse.ts`'s existing `extractBlocks()`
  export unchanged.
- **Go-to-definition's re-scan** matches the RFC's own Design section
  exactly: `findDeclarationOffset()` in `language-server/definition.ts`
  covers the same declaration shapes `scanDeclarations()` recognizes
  (`function name(...)`, `const/let name = ...`, and simple
  destructuring targets) — it does not attempt to cover shapes
  `scanDeclarations()` itself doesn't catch (destructured parameters,
  renamed destructuring), consistent with "Known false positives" below.
- **Each-block loop-variable scope-at-cursor** (completion's one piece
  of position-sensitive logic not already solved by `Scope`/
  `Diagnostic`): since `TNode` carries no source positions (the same
  property that makes go-to-definition need its own re-scan),
  `language-server/completion.ts`'s `loopVarsInScopeAt()` walks the REAL
  `parseTemplate()` AST left-to-right while advancing a text cursor
  through the template source in lockstep, re-locating each node's own
  text via `indexOf()` from the current cursor position (valid because
  the parser is itself a non-backtracking left-to-right scanner, so
  nodes appear in the AST in the same order their text appears in the
  source). This mirrors the recursive nesting `compiler/ir.ts`'s
  `lowerEach()` already walks to extend `local` scope for an
  each-block's children — reused here for a position lookup instead of
  lowering, per the RFC's own Design section wording. It is bookkeeping
  layered on top of the real AST's shape, not a second parser: no
  independent regex identifies template constructs (each/expr/element)
  that `parseTemplate()` didn't already identify.
- **Completion context classification** (`{...}` expression position vs.
  `<|` tag position) is a bounded backward text scan from the cursor
  (`classifyContext()`) tracking `{`/`}` depth and stopping at the
  nearest `>` seen at depth 0 (a tag/close-tag/each-close boundary) — a
  real bug surfaced during verification where a preceding `{/each}`'s
  closing `}` was otherwise mistaken for an unclosed brace around a
  LATER cursor position in tag position; the `>`-boundary fix is what
  makes tag-position completion correctly return componentNames/
  directives instead of expression-scope names right after a preceding
  each-block closes. Documented here since it's a real correctness
  finding from building this RFC, in the spirit of RFC-0006's
  hydrate-phase note, RFC-0007's `display:contents` finding, and
  RFC-0010's broadcast-trigger finding.

## Alternatives considered

- **A separate, LSP-maintained parser/grammar (common in other language
  tooling ecosystems, e.g. how some LSPs re-implement a lighter grammar
  for speed).** Rejected outright — the review is explicit or this
  point, and Najm's own architecture (RFC-0003's "no stage of this
  migration changes .najm file syntax") means the compiler's parser is
  already fast enough (regex/hand-rolled scanner, not a heavy AST
  library) that a second, lighter grammar would buy nothing except a
  second place for syntax support to drift out of sync.
- **Extend `compiler/semantics.ts`'s `Scope`/`Diagnostic` types with
  source-position data now, so the LSP doesn't need its own re-scan.**
  Considered, rejected for v1 (see Design's go-to-definition section) —
  would mean every non-LSP consumer of these types (the compiler's own
  `compile()` path) carries position bookkeeping it never uses. Revisit
  if the LSP-side re-scanning proves to be a real performance problem in
  practice, not preemptively.

## Verification

- **The reused-function premise, directly checked.** `language-server/
  extract.ts` imports `parseTemplate`/`extractBlocks` from
  `compiler/parse.ts` and `extractFunctionalParts` from
  `compiler/codegen.ts` (newly exported for this purpose);
  `language-server/diagnostics.ts` imports `analyzeSemantics` from
  `compiler/semantics.ts`. Confirmed by inspection: no file under
  `language-server/` contains a second `.najm`-template-shaped regex —
  `extract.ts`'s only local regex (`scanComponentNames()`) matches
  `codegen.ts`'s existing `scanComponentImports()`/`processScript()`
  import-line pattern for tag-name discovery only, not template parsing.
  **Done.**
- **`analyzeSemantics()`'s own correctness** (this RFC's actual
  foundation) remains independently verified per RFC-0003's Verification
  section — 20/20 `tests/test-semantics.ts` cases, zero false positives
  across all 10 real `.najm` files in this repo — unchanged by this RFC
  (no edit to `compiler/semantics.ts`'s resolution logic was made or
  needed). **Done.**
- **`najm-language-server` itself — built.** `language-server/`:
  `extract.ts` (shared template/scope extraction, both `.najm` styles),
  `positions.ts` (offset <-> LSP Position, `Diagnostic.expr`/
  `.identifier` -> document `Range`), `diagnostics.ts`, `definition.ts`,
  `completion.ts` (the three RFC-specified providers), `server.ts` (the
  stdio `vscode-languageserver`/`vscode-languageserver-textdocument`
  wiring: `onInitialize`, `onDidOpen`/`onDidChangeContent` ->
  `publishDiagnostics`, `onDefinition`, `onCompletion`). Root
  `package.json` gained `vscode-languageserver` and
  `vscode-languageserver-textdocument` as direct `dependencies`, plus an
  `npm run lsp` script (`tsx language-server/server.ts`) — see this
  RFC's Design section for why this lives in the root package rather
  than a new `packages/najm-*` entry. **Done.**
- **`tests/test-language-server.ts` — 14/14 passing**, covering exactly
  the LSP-specific layer (position mapping, protocol shapes), not
  re-proving `analyzeSemantics()`: a real unresolved-identifier typo
  fixture produces a diagnostic whose range's substring is verified
  character-for-character against the fixture text, for BOTH the
  functional-component style and an `about.najm`-shaped SFC fixture; a
  clean fixture of each style produces zero diagnostics; go-to-definition
  resolves a signal usage to its real `const x = signal(...)` line and
  returns `null` (not a throw) for an unresolvable identifier;
  `{...}`-completion includes declared scope AND each-block loop
  variables when the cursor is inside that block, excludes them when
  outside; tag-position completion returns component names plus exactly
  `client:load`/`client:visible`/`bind:value`/`bind:checked` and
  confirms `client:idle` is absent; the destructured-prop-parameter false
  positive is reproduced (not fixed) as a passing test asserting the LSP
  surfaces the identical diagnostic `analyzeSemantics()` produces; and a
  malformed/unextractable document is confirmed to produce empty
  results, never a throw, across all three providers. **Done.**
- **`npm test` (full suite, 15 files) — 100% green**, `tests/test-
  language-server.ts` registered in package.json's chain (verified by
  `tests/test-suite-registration.ts` itself, which fails the whole suite
  if a `tests/*.ts` file is ever added without being wired in — this
  file was added correctly on the first try, confirmed by that gate
  passing). `npx tsc --noEmit` is clean across the whole project
  (`tsconfig.json`'s `include` gained `"language-server"`). **Done.**
- **Zero false-positive regression check against every real `.najm` file
  in this repo** (`about.najm`, `index.najm`, `layout.najm`,
  `TodoList.najm`, `admin/index.najm`, `error-boundary-demo.najm`,
  `greet/[name].najm`, `partial-hydration-demo.najm`, `testing.najm`,
  `Crasher.najm` — all 10): `getDiagnostics()` run directly against each
  file's real source produced 0 diagnostics for every one, matching
  RFC-0003's own zero-false-positive claim for `analyzeSemantics()` —
  the LSP layer adds no new false positives beyond what the underlying
  compiler pass already documents. **Done.**
- **A real stdio JSON-RPC integration check** (`language-server/
  .dbg-lsp-integration.ts`, deliberately NOT wired into `npm test` — see
  that file's header comment: it spawns a real child process and talks
  real LSP wire framing, which is slower and has more moving parts than
  this repo's fast in-process unit suites, so it's kept as a standalone,
  manually-run script instead): spawns `language-server/server.ts` for
  real via `tsx`, sends a real `initialize` request over stdio, receives
  a real JSON-RPC response back
  (`{"capabilities":{"textDocumentSync":1,"definitionProvider":true,
  "completionProvider":{"triggerCharacters":["{","<",":"]}}}}`), sends
  `initialized` then `textDocument/didOpen` for a fixture containing
  `{cuont}` (a typo of a declared `count` signal), and receives a real
  `textDocument/publishDiagnostics` notification back over the same pipe
  with exactly one diagnostic, correct message, and a correct range —
  confirming the actual stdio JSON-RPC framing works end to end, not
  just the internal handler logic unit tests already cover. The child
  process is killed and the script exits 0 cleanly, no hang. **Done** —
  full request/response payloads captured in this RFC's implementing
  session's report.
- **`vscode/` LSP client wiring — still not done, correctly out of
  scope for this RFC.** `vscode/` (the existing syntax-highlighting-only
  TextMate grammar extension) still has no LSP client wired in — that
  remains RFC-0013's job specifically, which was blocked on this RFC's
  server existing. RFC-0013 is now unblocked but is not itself
  implemented by this session (out of scope — a different RFC).

## Open questions

- Should `Scope`/`Diagnostic` eventually gain source-position fields
  after all, once a second LSP feature (e.g. hover-for-type) needs them
  independently of go-to-definition's current re-scan approach? Deferred
  per the Alternatives section — no second need has surfaced yet.
- The destructured-prop-parameter and renamed-destructuring gaps
  (`compiler/semantics.ts`'s documented "NOT CAUGHT" list) will surface
  to real users FIRST through this LSP, likely before they ever hit
  `compile()`'s hard error in practice, since an editor's live
  diagnostics are seen continuously while a build error is seen once per
  save. Should closing those gaps be reprioritized as a `compiler/
  semantics.ts` follow-up BECAUSE of this RFC, even though RFC-0003 itself
  is marked Implemented? Flagged here rather than silently deferred —
  worth a real decision, not an assumption either way.
