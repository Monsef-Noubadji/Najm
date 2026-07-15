# Server tooling

The server package exposes three side-effectful entry modules:

- `@monsef-nbj/najm-server/dev` starts Vite-backed development rendering.
- `@monsef-nbj/najm-server/build` creates server and client production artifacts.
- `@monsef-nbj/najm-server/serve` previews those artifacts and reads `PORT`.

Use these as npm script targets. They are not request handlers or component imports. Production platforms must run the generated server output and serve the generated client asset directory under its original paths.
