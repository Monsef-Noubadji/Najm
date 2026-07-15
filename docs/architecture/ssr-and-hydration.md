# SSR and hydration architecture

Each request gets an isolated render context. Server builders emit escaped HTML and optional island descriptors. In the browser, claim cursors adopt those nodes and generated bindings reconnect signals and listeners. This avoids reconstructing static page regions.

The core sources are `runtime/ssr.ts`, `runtime/hydrate.ts`, and `runtime/client.ts`. See [RFC-0006](/rfcs/RFC-0006-ssr-and-rendering) and [RFC-0007](/rfcs/RFC-0007-islands-and-hydration).
