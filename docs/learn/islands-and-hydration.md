# Islands and hydration

An island is an interactive component boundary embedded in server HTML. Najm does not rerender the page in the browser: it claims existing nodes, reconnects generated bindings, and installs listeners.

`client:load` hydrates after the client runtime starts. `client:visible` waits for the island to intersect the viewport. Components without a client directive remain HTML-only and ship no component runtime.

Hydration depends on deterministic server and client structure. Avoid time, random values, browser globals, or request-global mutable state during initial rendering. If claiming fails, compare the emitted HTML to the component template and inspect conditional or repeated blocks first.
