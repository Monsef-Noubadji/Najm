# CLI

Najm ships the `najm` binary from `@monsef-nbj/najm`. Use it from project scripts instead of installing a separate CLI package.

## Create a project

```bash
pnpm dlx @monsef-nbj/najm create my-app
cd my-app
pnpm run doctor
pnpm run dev
pnpm run build
pnpm run preview
```

Najm does not publish a separate unscoped `create-najm-app` package in this release, so use `pnpm dlx @monsef-nbj/najm create my-app`.

The installed package also exposes a compatibility bin:

```bash
pnpm exec create-najm-app my-app
```

## Commands

| Command | Purpose |
| --- | --- |
| `najm dev [--port <n>]` | Start the development server for the current project. |
| `najm build` | Build production output into `dist/`. |
| `najm preview [--port <n>]` | Serve the production build from `dist/`. |
| `najm doctor` | Check Node version, package setup, `src/pages/`, build output, and dynamic-route notes. |
| `najm lint` | Run compiler-native diagnostics for `.najm` files under `src/`. |
| `najm create <dir>` | Scaffold a new project and run `pnpm install`. |
| `najm create-najm-app <dir>` | Compatibility alias for `najm create <dir>`. |
| `najm --help` | Print command help. |
| `najm --version` | Print the installed Najm package version. |

`--port` must be an integer from `1` through `65535`.

## Deferred test command

`najm test` is intentionally deferred in `1.1.0-rc.1`. Use the generated project's `package.json` test script or your own test runner.

## Exit behavior

Unknown commands, unknown flags, missing required arguments, invalid ports, and unexpected extra arguments exit non-zero and print a concise usage message. Long-running server commands forward stdio and stop when the parent process receives `SIGINT` or `SIGTERM`.
