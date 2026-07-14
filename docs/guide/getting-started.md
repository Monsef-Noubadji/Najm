# Getting started

> **Pre-release honesty note:** Najm is `0.3.0-dev` and **not yet published
> to npm**. There is no `npm install najm` today — you work from a clone of
> this repository, and the `najm` CLI is invoked through it
> (`npm run cli -- <command>` or `npx tsx cli/najm.ts <command>`). The
> `create-najm-app` scaffolder exists as a subcommand of that same CLI.

## Prerequisites

- **Node.js 20 or newer** (`najm doctor` checks this for you).
- git.

## 1. Clone and install

```bash
git clone <this-repo> najm && cd najm
npm install
```

Then verify your environment with the built-in diagnostics:

```bash
npm run cli -- doctor
```

Real output from a healthy checkout:

```text
✓ Node.js 26.3.1 (>= 20 required)
✓ package.json has a "najm" dependency (local framework source found)
✓ src/pages/ exists
✓ dist/manifest.json found
i 2 dynamic route(s) excluded from static generation (expected — request-time rendered): /admin, /greet/[name]
```

(The `dist/manifest.json` line only appears after you have run a build at
least once; before your first `najm build` it is reported as a hint, not a
failure.)

## 2. Start the dev server

```bash
npm run cli -- dev          # or: npm run dev
```

```text
  ▲ najm — dev server at http://localhost:3000
```

Open <http://localhost:3000>. Routes are re-scanned per request in dev —
adding a page under `src/pages/` is instantly live, with no restart and no
route registration.

Use `--port` to pick a different port:

```bash
npm run cli -- dev --port 5000
```

## 3. Scaffold a fresh app (optional)

The repository's own `src/pages/` is a complete, working example app. If you
want a minimal skeleton instead, `create-najm-app` writes one:

```bash
npm run cli -- create-najm-app my-app
```

Real output:

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

The generated project looks like this:

```text
my-app/
├── package.json          # scripts: dev / build / preview / test
├── .gitignore
├── src/
│   ├── pages/
│   │   ├── layout.najm          # root layout, wraps every page
│   │   ├── index.najm           # route: /
│   │   └── greet/
│   │       └── [name].najm      # route: /greet/:name
│   └── components/
│       └── Counter.najm         # example island
└── tests/
    └── test-example.ts          # node:assert style, no test framework
```

**Caveat (pre-release):** the generated `package.json` depends on the
*eventual* published packages (`najm`, `najm-compiler`, `najm-router`) and
its scripts call a `najm` binary that isn't on npm yet, so a scaffolded app
is not independently runnable today. Until the packages publish, the
practical workflow is to develop **inside the cloned framework repo** —
treat its `src/pages/` and `src/components/` as your app (or copy the
scaffolded files over them).

## 4. Make your first edit

Every route is a file. Create `src/pages/hello.najm`:

```js
export default function HelloPage(props = {}) {
  const greeting = "Hello from my first Najm page";
  return {
    template: `
      <main>
        <h1>{greeting}</h1>
        <p><a href="/">← home</a></p>
      </main>
    `,
  };
}
```

Visit <http://localhost:3000/hello> — it's already live. View the page
source: it is pure HTML with **no `<script>` tag**, because this page has no
islands. Interactivity is something you add deliberately — see
[Components](components.md) for signals and islands.

## 5. Production build and preview

```bash
npm run cli -- build        # or: npm run build
```

The build pre-renders every static-eligible route to HTML in `dist/static/`,
compiles dynamic routes for request-time rendering in `dist/server/`, and
bundles each island as its own hashed chunk in `dist/client/` (see the
[CLI reference](cli.md) for the full real output and `dist/` layout).

Then serve the build with the thin production server:

```bash
npm run cli -- preview      # or: npm run serve
```

```text
  ▲ najm — production server at http://localhost:4000
```

## Next steps

- [Components](components.md) — signals, the template syntax, islands.
- [Routing & SSR](routing-and-ssr.md) — dynamic routes, layouts, middleware.
- [CLI reference](cli.md) — every command in detail.
