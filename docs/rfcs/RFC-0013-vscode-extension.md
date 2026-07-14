# RFC-0013: VS Code Extension

- **Status:** Draft
- **Depends on:** RFC-0012 (now Implemented — see below)

Specifies packaging, syntax highlighting grammar, and file icons for
`.najm` files in VS Code — the syntax-highlighting half already exists as
a working prototype (`vscode/`, TextMate grammar over the
functional-component syntax) and needs revisiting once compiler syntax
changes (if any) affect it.

**Update:** this stub's blocker is now resolved — `language-server/`
(RFC-0012) is a real, stdio-verified LSP server implementing diagnostics,
go-to-definition, and completion, reusing `compiler/parse.ts`/
`compiler/semantics.ts` directly with zero forked grammar. Still a Stub
because the actual CLIENT wiring — spawning `language-server/server.ts`
as a child process from within `vscode/`'s extension host, registering
it via `vscode-languageclient`, and connecting it to the existing
syntax-highlighting extension's activation lifecycle — has no code yet.
This is now a well-scoped, independently buildable piece of work (the
conventional `vscode-languageclient` pattern, analogous to how
`language-server/server.ts` itself used the conventional
`vscode-languageserver` pattern) rather than blocked on anything else
not existing.

## Implementation

`vscode/src/extension.ts` — the standard `vscode-languageclient` pattern:
`activate(context)` constructs a `LanguageClient` whose `serverOptions`
run `npx tsx <extensionPath>/../language-server/server.ts` over stdio
(`TransportKind.stdio`, matching `server.ts`'s own explicit stdio wiring
— see its header comment), registers it for
`documentSelector: [{ scheme: 'file', language: 'najm' }]`, and starts
it; `deactivate()` stops the client. `vscode/package.json` gained
`"main": "./dist/extension.js"`, `"activationEvents":
["onLanguage:najm"]`, a `vscode-languageclient` dependency, and a
`build` script (`tsc -p ./tsconfig.json`) run before `vsce package`. The
pre-existing `contributes` block (grammar/language-configuration/icon
theme) is unchanged.

**Compiled JS, not `tsx`, for the extension itself.** `vscode/`'s own
`tsconfig.json` compiles `extension.ts` to CommonJS (`module`/
`moduleResolution: "Node16"`, required by `vscode-languageclient`'s
`exports` map) under `vscode/dist/`, matching how VS Code's extension
host loads extensions via `require()` in a plain Node context, and
matching this repo's own precedent of using `tsc` for typechecking
rather than introducing a new bundler (esbuild was considered per the
task brief and rejected — `tsc` alone was sufficient, no bundling of
`node_modules` into a single file was needed since the packaging gap
below means the extension currently expects `node_modules` to be
present anyway). Root `tsconfig.json`'s `include` gained `"vscode/src"`
so `npx tsc --noEmit` at the repo root also typechecks the extension
against the same `vscode-languageclient`/`@types/vscode` packages
(added to root `devDependencies`/`dependencies` for typecheck purposes;
`vscode/package.json` separately declares its own runtime
`vscode-languageclient` dependency for when `vsce package` bundles the
folder standalone).

**Known packaging gap, documented rather than solved.** The server is
spawned via `npx tsx <path-to-language-server>/server.ts`, with the
path resolved relative to `context.extensionPath`. This works when the
extension runs from within this repo (F5 / Extension Development Host,
where `vscode/` is a sibling of `language-server/` and the repo's own
`tsx` devDependency is reachable). It does **not** work for a real user
who installs the packaged `.vsix`: the `.vsix` contains only `vscode/`'s
own files, not `language-server/` or the root `node_modules`/`tsx` — so
the relative path won't resolve and `npx tsx` cannot assume an end user
has Node/tsx tooling available. A real fix needs the language server
bundled and compiled into the packaged extension (e.g. an esbuild
bundle of `language-server/server.ts` shipped as `vscode/dist/server.js`
and spawned with plain `node`), which is its own bundling project,
deliberately out of scope for this RFC per its brief — noted here as
the concrete next step rather than left implicit or silently assumed
solved.

## Verification

- **`npx tsc --noEmit` (whole repo, including `vscode/src/extension.ts`)
  — clean.** **Done.**
- **`vscode/`'s own build (`tsc -p vscode/tsconfig.json`) — produces
  valid `vscode/dist/extension.js`** (CommonJS, `require()`-able).
  **Done.**
- **`tests/test-vscode-client.ts` — 12/12 passing**, registered in
  `package.json`'s test script (confirmed by
  `tests/test-suite-registration.ts`'s own gate). This suite is
  explicitly a STRUCTURAL/WIRING check, not a VS Code activation check —
  its own header comment states this distinction plainly, the same way
  `language-server/server.ts`'s header comment does for its own
  coverage boundary. It verifies: `vscode/package.json`'s
  `main`/`activationEvents`/`contributes`/dependency shape;
  `extension.ts`'s source references the correct server path and
  `documentSelector`; the real `tsc` build step produces valid JS; and a
  lighter-weight smoke check that `require()`-ing the compiled
  `dist/extension.js` runs our own code without throwing, only failing
  at the expected boundary (`vscode-languageclient` internally
  requiring the real `vscode` module, which only exists inside a real
  extension host — confirmed by inspecting the thrown error's
  `requireStack`, not just catching any error). **Done.**
- **`npm test` (full suite, 16 files) — 100% green.** **Done.**
- **Real VS Code activation — NOT verified, explicitly.** No
  `@vscode/test-electron` integration run was performed; nobody has
  loaded this extension inside a real VS Code window and confirmed
  diagnostics/go-to-definition/completion actually appear for a `.najm`
  file. This is a deliberate scope boundary stated in this RFC's
  originating task, not an oversight — confirming it needs either a
  human manually installing the `.vsix` (`F5` Extension Development
  Host or `vsce package` + `code --install-extension`) or a
  `@vscode/test-electron` CI harness, both heavier than this task's
  verification budget.

**Status: Draft, not Implemented.** Per the distinction this RFC series
draws elsewhere (e.g. RFC-0012's own "structurally verified" layers vs.
its one real end-to-end stdio integration check) between "the code
exists and is structurally verified" and "fully proven end-to-end":
everything static-analysis-and-build-time-checkable here is
done and green, but the one thing that actually matters for a VS Code
extension — does it activate and produce real diagnostics inside a real
VS Code window — is unverified. RFC-0012 could credibly claim
"Implemented" because it had a real stdio JSON-RPC integration check
(`language-server/.dbg-lsp-integration.ts`) exercising the actual
protocol end to end, not just unit tests of internal handlers. This RFC
has no analogous end-to-end check — the closest available substitute
(`require()`-ing the compiled extension outside VS Code) necessarily
stops at the extension-host boundary, since `vscode` itself isn't
requireable outside a real host. Calling this "Implemented" would claim
more confidence than the evidence supports; "Draft" with this explicit
caveat is the honest call, and matches the packaging gap above being a
real, unresolved rough edge rather than a hypothetical one.
