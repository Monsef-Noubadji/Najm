# CLI reference

The `najm` CLI has six commands. Because Najm is pre-release and not on npm
yet, there is no global `najm` binary — invoke it through the cloned
repository:

```bash
npm run cli -- <command>          # or: npx tsx cli/najm.ts <command>
```

Running with no command (or `--help`) prints the real usage text:

```text
usage: najm <command> [options]

commands:
  dev [--port <n>]      start the dev server
  build                  produce a production build in dist/
  preview [--port <n>]  serve the production build
  doctor                 run setup diagnostics
  lint                    check every .najm file under src/ compiles

  create-najm-app <dir>  scaffold a new Najm project
```

All command outputs below are real captured output from this repository.

## `najm dev [--port <n>]`

Starts the development server (default port **3000**; `--port` maps to the
`PORT` environment variable).

```text
  ▲ najm — dev server at http://localhost:3000
```

Routes under `src/pages/` are re-scanned per request — adding or renaming a
page is live immediately, no restart.

## `najm build`

Produces a production build in `dist/`. Real output from this repository:

```text
  najm build — 7 route(s) found
    static:  /about, /error-boundary-demo, /, /partial-hydration-demo, /testing
    dynamic: /admin, /greet/[name]

  ✓ static  /about                   -> dist/static/about.html
  ✓ static  /error-boundary-demo     -> dist/static/error-boundary-demo.html
  ✓ static  /                        -> dist/static/index.html
  ✓ static  /partial-hydration-demo  -> dist/static/partial-hydration-demo.html
  ✓ static  /testing                 -> dist/static/testing.html
  ✓ dynamic /admin                   -> dist/server/admin/index.js (request-time render)
  ✓ dynamic /greet/[name]            -> dist/server/greet/_name_.js (request-time render)

  ▲ najm build complete — dist/manifest.json written (7 routes, 1 island chunk(s))
```

(Routes with dynamic segments or middleware are classified request-time —
see [Routing & SSR](routing-and-ssr.md#static-pre-rendering-vs-request-time-rendering).)

### What `dist/` contains

The real tree produced by the build above:

```text
dist/
├── manifest.json                # route table + island source→asset mapping
├── static/                      # pre-rendered HTML, served as plain files
│   ├── index.html
│   ├── about.html
│   ├── error-boundary-demo.html
│   ├── partial-hydration-demo.html
│   └── testing.html
├── server/                      # compiled SSR modules (plain Node ESM)
│   ├── index.js  about.js  layout.js  …
│   ├── admin/
│   │   ├── index.js
│   │   └── middleware.js        # middleware compiles too — enforced at request time
│   ├── greet/
│   │   └── _name_.js            # [name].najm, filesystem-safe name
│   └── assets/                  # shared server chunks
└── client/                      # hashed browser chunks, one per distinct island
    ├── runtime.js               # the shared runtime, paid once per page
    ├── client-manifest.json
    └── assets/
        └── TodoList.eZzXy6LZ.js # this repo's one island
```

`manifest.json` is what the production server reads — each route is either
`static` (pointing at its HTML file) or `dynamic` (pointing at its compiled
page/layout/middleware modules), plus the island mapping:

```json
{
  "routes": [
    { "type": "static", "pathname": "/", "htmlFile": "static/index.html" },
    {
      "type": "dynamic",
      "pathname": "/greet/[name]",
      "hasDynamicSegments": true,
      "modulePath": "server/greet/_name_.js",
      "layoutPaths": ["server/layout.js"],
      "middlewarePaths": []
    }
  ],
  "islands": {
    "/src/components/TodoList.najm": "/client/assets/TodoList.eZzXy6LZ.js"
  }
}
```

## `najm preview [--port <n>]`

Serves the `dist/` build with the thin production server (default port
**4000**): static routes as files, dynamic routes rendered per request with
their middleware chain enforced.

```text
  ▲ najm — production server at http://localhost:4000
```

## `najm doctor`

Environment and project diagnostics. Exit code 0 when healthy. Real output:

```text
✓ Node.js 26.3.1 (>= 20 required)
✓ package.json has a "najm" dependency (local framework source found)
✓ src/pages/ exists
✓ dist/manifest.json found
i 2 dynamic route(s) excluded from static generation (expected — request-time rendered): /admin, /greet/[name]
```

## `najm lint`

Runs every `.najm` file under `src/` through the **real compiler** — the
same parser and semantic analysis `najm build` and the language server use.
It reports template parse errors and unresolved identifiers (a typo'd name
in a template is an error naming that identifier). It is not a general
JS/TS linter — no style rules.

```text
najm lint: no problems found
```

On problems, each line is `file:line  message` and the exit code is 1.

## `najm create-najm-app <dir>`

Scaffolds a new project (root layout, index page, one example island, one
dynamic route, an example test, `package.json`, `.gitignore`). Fails if the
target directory exists and is not empty. Real output:

```text
  ▲ create-najm-app — scaffolded 7 file(s) in C:\...\my-app

    src/pages/layout.najm
    src/pages/index.najm
    src/pages/greet/[name].najm
    src/components/Counter.najm
    tests/test-example.ts
    package.json
    .gitignore
```

See [Getting started](getting-started.md#3-scaffold-a-fresh-app-optional)
for the generated tree and the pre-release caveat about the scaffolded
`package.json` (it targets the eventual published packages).
