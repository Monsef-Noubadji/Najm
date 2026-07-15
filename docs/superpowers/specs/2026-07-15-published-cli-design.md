# Published CLI Design

## Status

Candidate design for the Najm CLI hardening cycle that will ship first as `1.1.0-rc.0`. Implementation must not start until this spec is reviewed and approved.

## Goal

Make `@monsef-nbj/najm` the installable framework package engineers can use directly for project commands and project creation, while preserving the existing runtime API and keeping `najm test` deferred.

## Current State

Najm 1.0.0 is published as coordinated packages:

- `@monsef-nbj/najm`
- `@monsef-nbj/najm-compiler`
- `@monsef-nbj/najm-router`
- `@monsef-nbj/najm-server`

The repo already has CLI source in `cli/` and tests in `tests/test-cli.ts`, but the CLI is currently repo-internal. It runs through `tsx cli/najm.ts`, has no published `bin`, and resolves app state from the framework repo root instead of the consumer project's current working directory.

## Package Architecture

`@monsef-nbj/najm@1.1.0-rc.0` becomes the umbrella framework package.

The package keeps its existing runtime API:

- `@monsef-nbj/najm`
- `@monsef-nbj/najm/core`

The package adds Node-only CLI entry points:

- `bin.najm -> dist/cli.js`
- `bin.create-najm-app -> dist/create-app.js`

The CLI entries must stay isolated from the browser/runtime graph. Runtime imports must not pull Node built-ins or CLI code into client bundles.

`@monsef-nbj/najm` will depend on the coordinated framework packages it needs for CLI operation:

- `@monsef-nbj/najm-compiler`
- `@monsef-nbj/najm-router`
- `@monsef-nbj/najm-server`

`vite` remains a peer dependency because the compiler/server toolchain expects the consuming app to own the Vite version.

Node support remains `>=20`.

## Supported Commands

The published `najm` binary supports:

```text
najm dev [--port <n>]
najm build
najm preview [--port <n>]
najm doctor
najm lint
najm create <dir>
najm create-najm-app <dir>
najm --help
najm --version
```

`najm create <dir>` is the primary project creation command.

`najm create-najm-app <dir>` remains as a compatibility alias for the repo's existing command shape.

The published `create-najm-app` binary supports:

```text
create-najm-app <dir>
create-najm-app --help
create-najm-app --version
```

`najm test` remains deferred. The CLI must print a clear error if a user tries it:

```text
najm test is deferred for this release. Use your project's package.json test script.
```

## Transient Creation Commands

Because the framework package is scoped, the guaranteed transient creation commands are:

```text
pnpm dlx @monsef-nbj/najm create my-app
pnpm dlx @monsef-nbj/najm create-najm-app my-app
pnpm dlx --package @monsef-nbj/najm create-najm-app my-app
```

After a local install, both bins are available through package scripts or `pnpm exec`:

```text
pnpm exec najm dev
pnpm exec create-najm-app my-app
```

This spec does not promise bare `npx create-najm-app my-app` or bare `pnpm dlx create-najm-app my-app`, because that requires publishing a separate unscoped `create-najm-app` package. That package is out of scope for this release unless explicitly approved.

## Command Data Flow

All app commands resolve the consumer project from `process.cwd()`.

`najm dev` imports or invokes the built server dev entry from `@monsef-nbj/najm-server/dev`, with the current working directory as the app root.

`najm build` imports or invokes `@monsef-nbj/najm-server/build`, with the current working directory as the app root.

`najm preview` imports or invokes `@monsef-nbj/najm-server/serve`, with the current working directory as the app root.

`najm doctor` checks the current working directory, not the installed package location.

`najm lint` checks `.najm` files under the current working directory's `src/` tree.

Long-running child processes must forward stdio and terminate cleanly when the parent receives `SIGINT` or `SIGTERM`.

## Argument Handling

The CLI remains dependency-free for parsing. It should use a small internal parser because the command surface is narrow.

`--port` accepts only an integer from `1` through `65535`.

Unknown commands, unknown flags, missing required arguments, invalid port values, and unexpected extra arguments exit non-zero and print a concise usage message.

`--help` exits `0`.

`--version` prints the version from `@monsef-nbj/najm/package.json` and exits `0`.

## Project Creation

Project creation writes one professional default template, then runs `pnpm install`.

Generated projects use the current CLI package version for Najm packages. During the RC cycle, a project created by `@monsef-nbj/najm@1.1.0-rc.0` should install coordinated `1.1.0-rc.0` Najm packages.

Generated apps should use direct dependencies for packages their source imports directly:

- `@monsef-nbj/najm`
- `@monsef-nbj/najm-compiler`
- `@monsef-nbj/najm-router`
- `@monsef-nbj/najm-server`
- `vite`

Generated dev dependencies include:

- `tsx`
- `typescript`

Generated package scripts:

```json
{
  "dev": "najm dev",
  "build": "najm build",
  "preview": "najm preview",
  "lint": "najm lint",
  "doctor": "najm doctor",
  "test": "tsx tests/test-example.ts"
}
```

The scaffold refuses to write into a non-empty directory.

If `pnpm` is missing, the scaffold still writes the project and exits non-zero with a clear message:

```text
Project files were created, but pnpm was not found. Install pnpm, then run `pnpm install` in <dir>.
```

If `pnpm install` fails, the scaffold exits non-zero and prints:

```text
Project files were created, but `pnpm install` failed. Resolve the package-manager error, then run `pnpm install` in <dir>.
```

No interactive package-manager choice is included in this release.

## Error Handling

Errors should explain what the engineer can do next.

Examples:

- Missing `src/pages/`: `src/pages/ was not found. Create src/pages/index.najm or run najm create <dir> to start a project.`
- Missing production build before preview: `dist/manifest.json was not found. Run najm build before najm preview.`
- Invalid port: `--port must be an integer between 1 and 65535.`
- Non-empty create target: `<dir> already exists and is not empty. Choose an empty directory.`

Unexpected internal errors should exit `1` and show the original error message without a noisy stack trace by default.

## Documentation

The docs must be updated for engineers adopting Najm:

- Getting started uses `pnpm dlx @monsef-nbj/najm create my-app`.
- CLI reference documents every command, flag, exit behavior, and deferred `najm test` status.
- Package reference explains that `@monsef-nbj/najm` is both runtime package and CLI umbrella package.
- Release status documents the `1.1.0-rc.0` CLI hardening cycle.

## Evidence Gate

The release can move to `1.1.0-rc.0` only after evidence is collected for:

- Unit and subprocess CLI tests.
- Package build and package smoke tests.
- Packed tarball installation in a clean temporary project.
- `pnpm dlx` project creation from the packed package when feasible locally, or equivalent local tarball execution evidence if registry publication is required for true `dlx`.
- A clean-room adopter project in a new folder that follows the docs exactly:
  - create project
  - dependency install
  - `pnpm run doctor`
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run preview`
  - browser or HTTP verification of a rendered route
- Full repo test suite.
- Typecheck.
- Docs build.

Any failing evidence item must be fixed or explicitly recorded as a release blocker.

## Out of Scope

- Implementing `najm test`.
- Publishing a separate unscoped `create-najm-app` package.
- Adding a third-party CLI parser.
- Adding multiple templates.
- Adding interactive prompts.
- Changing runtime API behavior.
- Changing server rendering semantics.
