# Packages

| Import | Role | Environment |
| --- | --- | --- |
| `@monsef-nbj/najm` | Runtime root export | Browser and server |
| `@monsef-nbj/najm/core` | Explicit runtime export | Browser and server |
| `@monsef-nbj/najm/package.json` | Package metadata | Tooling |
| `@monsef-nbj/najm-compiler` | Compiler and Vite plugin | Build tooling |
| `@monsef-nbj/najm-compiler/vite` | Vite plugin alias | Build tooling |
| `@monsef-nbj/najm-compiler/plugin-api` | Compiler plugin types and hooks | Build tooling |
| `@monsef-nbj/najm-compiler/package.json` | Package metadata | Tooling |
| `@monsef-nbj/najm-router` | Route resolution | Server/tooling |
| `@monsef-nbj/najm-router/middleware` | Middleware contracts | Server |
| `@monsef-nbj/najm-router/package.json` | Package metadata | Tooling |
| `@monsef-nbj/najm-server/dev` | Starts development server | Executable tooling |
| `@monsef-nbj/najm-server/build` | Runs production build | Executable tooling |
| `@monsef-nbj/najm-server/serve` | Starts production preview | Executable tooling |
| `@monsef-nbj/najm-server/package.json` | Package metadata | Tooling |

All packages require Node.js 20+. Compiler and server packages accept Vite 5 or newer as a peer. Server exports execute work when loaded and are intended as script entry modules, not application libraries.
