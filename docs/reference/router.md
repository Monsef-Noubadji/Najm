# Router API

`resolvePage(pathname, pagesRoot)` resolves static, dynamic `[param]`, and catch-all `[...param]` routes and returns the page plus parameters and layouts. `listRoutes(pagesRoot)` enumerates routable files for tooling and static generation.

Middleware runs in route order and returns a continue, redirect, or response result. Validate redirect targets and never interpolate untrusted values into headers. Route resolution is filesystem-sensitive and belongs on the server or in trusted build tooling.
