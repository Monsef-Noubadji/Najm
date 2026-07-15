# Production

## Build and preview

Run `npm run build` to produce client assets and server-rendering output, then `npm run serve` to exercise the production path locally. Set `PORT` to override the preview server port.

The `@monsef-nbj/najm-server/build`, `/dev`, and `/serve` exports are side-effectful tooling entry modules. Invoke them from scripts; do not import them into application components.

## Deployment contract

Deploy both the generated server bundle and public client assets. Static routes can be served as generated HTML; dynamic routes require a Node.js 20+ process. Preserve asset paths exactly so island modules can load when a trigger fires.

Before release, test direct navigation to dynamic and catch-all routes, verify middleware redirects, disable JavaScript to inspect the HTML baseline, and confirm that `client:visible` islands hydrate after entering the viewport.
