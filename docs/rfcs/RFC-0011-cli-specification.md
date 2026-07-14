# RFC-0011: CLI Specification

- **Status:** Implemented (five of six subcommands proven end-to-end via
  real subprocess invocation; `najm test` explicitly out of scope for
  this pass — see Open questions, unchanged, and the Verification
  section below for exactly what's proven vs. not)
- **Depends on:** RFC-0006 (SSR), RFC-0007 (Islands), RFC-0008 (Routing) — all Implemented
- **Formalizes:** `server/dev.ts`, `server/build.ts`, `server/serve.ts`
  (all implemented, invoked today via `npm run dev/build/serve`);
  **specifies:** a real `najm` binary wrapping them, plus commands that
  don't exist yet (`doctor`, `lint`, `create-najm-app` scaffolding)

## Summary

Today, Najm's command surface is three `npm run` scripts calling `tsx`
directly against `server/dev.ts`, `server/build.ts`, `server/serve.ts` —
correct, working, and exactly what RFC-0006/0007/0008 verified against.
This RFC specifies the thin `najm` binary that wraps them with proper
argument parsing and the additional commands the architecture review's
API-organization section names (`doctor`, `lint`) plus scaffolding
(`create-najm-app`). It deliberately does NOT change what `dev`/`build`/
`serve` (renamed `preview` for CLI consistency with the review's naming,
see below) actually do — this RFC is a packaging and ergonomics layer
over already-Implemented infrastructure, not new render/build logic.

## Motivation

`npm run build && npm run serve` already works end to end — verified
directly: `npm run build` produces `dist/{static,server,client}/` and
`dist/manifest.json`; `npm run serve` reads that manifest, serves
pre-rendered HTML for static routes with zero JS where no island exists,
and runs the same compiled-module render pipeline `server/dev.ts` uses
for request-time routes (dynamic segments, middleware-guarded routes),
now from built files instead of live Vite transforms. What's missing is
not build capability — it's the CLI ergonomics a real user expects:
`npx najm dev` instead of knowing to run `tsx server/dev.ts` from a
specific working directory, `--port` instead of an environment variable,
a `doctor` command that catches the class of setup mistake (wrong Node
version, missing `dist/` before `serve`) an error stack trace explains
badly.

## Design

### Command surface

```text
najm dev [--port <n>]         wraps server/dev.ts (implemented)
najm build                    wraps server/build.ts (implemented)
najm preview [--port <n>]     wraps server/serve.ts (implemented; "preview"
                               matches the review's naming and Vite's own
                               convention — "serve" is kept as the npm
                               script name for continuity, "preview" is
                               the CLI-facing verb)
najm doctor                   new — see below
najm test                     new — thin wrapper: today IS `tsx
                               tests/test-*.ts` chained; najm test is
                               that chain, invocable from any project
                               using najm as a dependency once
                               packages/ ships (RFC-0018), not a new
                               test runner
najm lint                     new — see below, narrower than "a linter"
create-najm-app <dir>         new — scaffolding, see below
```

### `najm dev` / `najm build` / `najm preview`: thin wrappers, verified equivalence

Each subcommand is a thin argument-parsing layer that `spawn`s (or
directly `import()`s and calls) the corresponding `server/*.ts` entry
point unchanged. `--port` maps to the `PORT` environment variable
`server/dev.ts`/`server/serve.ts` already read (grep-confirmed: both
files read `process.env.PORT`). This RFC does not touch
`server/dev.ts`/`build.ts`/`serve.ts` internals — RFC-0006/0007/0008's
verification against those files stays valid; the CLI is packaging, not
new render logic.

### `najm doctor`: setup diagnostics, not a linter

```text
$ najm doctor
✓ Node.js 22.x (>= 20 required)
✓ package.json has a "najm" dependency
✓ src/pages/ exists
✗ dist/ not found — run `najm build` before `najm preview`
```

A short, fixed checklist: Node version, presence of `src/pages/`,
presence of a `dist/manifest.json` before `preview` is attempted,
detecting a `src/pages/[dynamic].najm` route with no corresponding
build-time static path (informational — RFC-0008/this RFC's build
pipeline already correctly excludes these from static generation; doctor
just surfaces that this is EXPECTED, not a build failure, since a first-
time user seeing "route excluded from static build" in build's own
output could reasonably wonder if that's a bug). Explicitly NOT a general
static analyzer — that's `najm lint`'s job, scoped separately below, and
NOT a health-check server/monitoring tool — `doctor` runs once, reports,
exits.

### `najm lint`: compiler-native `.najm` diagnostics, not a JS linter

Deliberately narrow for v1: `najm lint` runs every `.najm` file in
`src/` through `compiler/parse.ts`'s parser (already the exact parser
`compiler/plugin.ts`'s Vite transform uses — no second grammar) and
reports parse errors with file:line, plus the specific compile-time
rejections the compiler already throws today (e.g. `{@html}` used inside
an island, per `parse.ts`'s existing doc comment on why that's rejected;
`client:idle` as an unsupported directive, per RFC-0007's parser
extension). This is NOT a general JS/TS linter (ESLint's job, if a user
wants one, on their own `.ts` files) and NOT the semantic-diagnostic
surface RFC-0012 (Language Server) will eventually provide (real
scope-resolution diagnostics like "this signal doesn't exist" need
RFC-0003's deferred semantic-analysis pass, which doesn't exist yet — see
RFC-0012's own stub). `najm lint` is: can every `.najm` file in this
project compile, yes or no, with the same errors `najm build` would
throw, but checkable without a full build.

### `create-najm-app <dir>`: one template, not three

The architecture review's original ask was SSR/SSG/SPA templates with
integrated Vitest. Scoped down for v1: **one** template — what
`src/pages/` already looks like in this repo (a `layout.najm`, an
`index.najm`, an example island, an example dynamic route) — copied into
a new directory with `package.json` pointing at published `najm`/
`najm-compiler`/`najm-router` versions (RFC-0018's stability contract)
instead of this repo's local path aliases. No Vitest integration: per
RFC-0015, Najm's own tests are framework-free `node:assert` scripts, and
scaffolding a new project with a DIFFERENT testing philosophy than the
framework itself uses would be an unexplained inconsistency. A generated
project gets a `tests/` directory with one example file in the same
style, not a Vitest config. Multiple templates (a genuinely SPA-only
mode, skipping SSR entirely) are future work, not v1 — RFC-0001's
anti-speculation stance: one real template beats three half-designed ones.

### What this RFC does NOT add

- No new build/render behavior — every byte of HTML/JS this RFC's
  commands produce is identical to what `npm run build`/`serve`/`dev`
  already produce today, verified in RFC-0006/0007/0008.
- No plugin-configurable build steps (Markdown, MDX, etc.) — that's
  RFC-0009's job once it exists; `najm build` today is exactly "compile
  every `.najm` file the same way `compiler/plugin.ts` always has,
  classify routes, bundle islands," with no extension points.
- No watch-mode `build --watch` — `najm dev` already provides the
  live-reload development loop; a watch-mode production build wasn't
  asked for by any existing verification and would be speculative scope.

## Alternatives considered

- **Ship `najm dev`/`build`/`preview` as the ENTIRE v1 CLI, defer
  `doctor`/`lint`/scaffolding to a later RFC revision.** Considered
  seriously — those three are zero-risk (already-verified wrappers) while
  `doctor`/`lint`/scaffolding are new surface. Decided against splitting:
  the architecture review names all of these under one "CLI" heading, and
  `doctor`/`lint` as specified above are narrow enough (a fixed checklist;
  parser-only diagnostics) not to warrant their own RFC. Scaffolding
  remains the piece most likely to need revision once `packages/`
  actually publishes (RFC-0018/0019) — flagged as an explicit follow-up
  risk, not hidden.
- **A general-purpose `najm lint` covering arbitrary JS/TS style rules.**
  Rejected — ESLint already exists and does this well; duplicating it
  inside Najm's CLI would be exactly the "feature parity with a
  competitor" RFC-0001 warns against without reinforcing Najm's own
  philosophy.

## Verification

The `najm` binary now exists at `cli/najm.ts` (`cli/doctor.ts`,
`cli/lint.ts`, `cli/scaffold.ts` hold each subcommand's logic; `najm.ts`
is argument parsing + dispatch only). `tests/test-cli.ts` (15 cases) is
wired into `package.json`'s `test` script, ahead of
`test-suite-registration.ts` per that suite's own ordering convention.
`npm test` (full suite, all 16 files) and `npx tsc --noEmit` are both
green as of this pass.

**Proven end-to-end (real subprocess, real ports/HTTP, real filesystem
output — not just internal function calls):**

- `najm doctor`: run as `spawnSync(node, [tsx, cli/najm.ts, 'doctor'])`
  against this actual repo. Exits 0; output verbatim-matched below.
- `najm lint`: run the same way against this repo's real `src/`
  (clean, exit 0, "no problems found") AND against a throwaway fixture
  written into `src/pages/.cli-lint-test-tmp/typo.najm` containing the
  same `{cuont}` typo pattern used elsewhere in this repo's test
  fixtures (`tests/test-language-server.ts`) — real `file:line`
  diagnostic, exit 1, fixture cleaned up after the assertion.
- `najm build`: run as a real subprocess; produces a real
  `dist/manifest.json` with the same shape `npm run build` produces
  (`/about` present and classified `static`) — this is the one wrapper
  test that pays the cost of a full real build (not a structural-only
  check), matching `tests/test-build.ts`'s own choice to do the same
  for the `npm run build` path.
- `najm dev --port <n>` / `najm preview --port <n>`: each spawned as a
  real subprocess, polled until a real HTTP GET to
  `http://localhost:<n>/about` returns 200, then killed — proves
  `--port` really reaches `server/dev.ts`/`server/serve.ts`'s
  `process.env.PORT` read, not just that the flag is parsed.
- `create-najm-app <dir>`: run as a real subprocess against a real
  `os.tmpdir()` directory; asserts the exact file set RFC-0011 specifies
  (`layout.najm`, `index.najm`, one island, one dynamic route,
  `package.json`, one `tests/test-example.ts`, no `vitest.config.*`),
  that the generated `package.json` is valid JSON referencing
  `najm`/`najm-compiler`/`najm-router` (not this repo's local
  `najm/core` / `@najm/runtime` aliases), and that the generated test
  file is `node:assert`-style.

**Unit-tested only (direct function calls, not re-proven via
subprocess beyond the above):** `cli/doctor.ts`'s individual check
logic (Node-version arithmetic, the informational dynamic-route
surfacing) and `cli/lint.ts`'s diagnostic formatting are also exercised
by calling `runDoctor()`/`lintSource()`/`lintDir()` directly — faster,
and this project's established pattern (see RFC-0012's language-server
suite) of pairing a fast in-process suite with at least one real
wire/process-level round trip rather than only one or the other.

**Explicitly NOT proven:** byte-identical `dist/` output between `najm
build` and `npm run build` (the test asserts manifest *shape* and one
route's classification match, not a full recursive diff of every
emitted file) — a stronger assertion than what RFC-0011 originally
called for, and left as a real follow-up if bytewise parity ever
becomes load-bearing. `najm test` (the RFC's sixth named command) is
NOT implemented — per the Open Questions section below (unchanged by
this pass), it's genuinely blocked on `packages/` publishing
(RFC-0018/0019); building it now would mean wrapping `npm test`
speculatively with no real "does a consumer's generated project have
tests to run" story yet, which RFC-0001's anti-speculation stance
argues against. The `package.json` `"bin"` field wiring a real,
globally-installable `najm`/`create-najm-app` binary is also NOT done:
this Node version cannot execute `cli/najm.ts` directly (`node
cli/najm.ts doctor` fails with `ERR_MODULE_NOT_FOUND` — this codebase's
extensionless-relative-import convention throughout is incompatible
with Node's native TS handling), so a real `bin` entry would need
either a compiled `.js` entry point or a shebang-wrapped shell shim
that re-execs through `tsx`; today's real, verified invocation path is
`npx tsx cli/najm.ts <command>`, wired up in this repo as `npm run cli
-- <command>`.

Verbatim `najm doctor` output against this repo:

```text
✓ Node.js 26.3.1 (>= 20 required)
✓ package.json has a "najm" dependency (local framework source found)
✓ src/pages/ exists
✓ dist/manifest.json found
i 2 dynamic route(s) excluded from static generation (expected — request-time rendered): /admin, /greet/[name]
```

Verbatim `najm lint` output against a fixture with a real typo
(`{cuont}`, same pattern as `tests/test-language-server.ts`'s fixture):

```text
src/pages/.cli-lint-test-tmp/typo.najm:7  `cuont` is not defined — expected a declared signal, prop, function, or loop variable in scope

najm lint: 1 problem(s) found
```

## Open questions

- Should `najm test` exist at all before `packages/` actually publishes
  `najm` et al. (RFC-0018/0019)? Today "run the tests" only makes
  sense inside THIS repo (`npm test`, RFC-0015's own convention) — a
  `najm test` subcommand implies a published package's consumer can run
  it against their own project, which presumes a testing story for
  NAJM-USER code, not Najm's own. Likely means `najm test` is deferred
  until there's a real answer to "what does a generated project's
  `tests/` directory actually test," not just wrapping `npm test`.
