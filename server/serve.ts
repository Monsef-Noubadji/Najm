/**
 * Najm production server — server/serve.ts
 * =================================================================
 * The thin counterpart to server/build.ts's output. Deliberately does
 * NOT run Vite in middleware mode — dev.ts's live-transform cost has no
 * benefit once dist/ holds compiled output. For a request:
 *
 *   - matched against dist/manifest.json's static routes → the
 *     pre-rendered HTML file is served directly.
 *   - dist/client/* is served as plain static assets (hashed island
 *     chunks + the runtime bundle the hydration bootstrap imports).
 *   - matched against a dynamic (request-time) route → the compiled
 *     module is loaded via plain Node `import()` (no Vite) and run
 *     through the SAME render pipeline dev.ts's renderPage() uses:
 *     resolve params, run middleware, renderToHtml, fold layouts,
 *     wrap in the shell. The only difference from dev.ts is where the
 *     modules come from (dist/server/*.js on disk vs. Vite's live
 *     transform of src/pages/*.najm).
 *
 * Route matching against the manifest reuses the exact same pattern
 * logic as router/router.ts (static > dynamic > catch-all specificity)
 * so a request resolves identically to how dev mode would resolve it —
 * this file does not reimplement matching by hand; concrete pathnames
 * are matched against each manifest entry's pathname pattern.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { runMiddlewareChain } from '../router/middleware';
import type { MiddlewareModule } from '../router/middleware';
import type { IslandRef } from '../runtime/ssr';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 4000);

interface StaticRouteManifestEntry {
  type: 'static';
  pathname: string;
  htmlFile: string;
}
interface DynamicRouteManifestEntry {
  type: 'dynamic';
  pathname: string;
  hasDynamicSegments: boolean;
  modulePath: string;
  layoutPaths: string[];
  middlewarePaths: string[];
}
type RouteManifestEntry = StaticRouteManifestEntry | DynamicRouteManifestEntry;
interface Manifest {
  routes: RouteManifestEntry[];
  islands: Record<string, string>;
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));

// CRITICAL: dist/server/*.js bundles `najm/core` into each compiled
// page (server/build.ts's serverConfig does not externalize it), and
// Rollup automatically factors the shared runtime code every entry
// point imports into one shared chunk (dist/server/assets/ssr-*.js) —
// so every compiled page's renderIsland()/registerStyle() calls already
// write into ONE shared module instance. beginRender()/endRender() must
// be driven through that SAME instance, not a fresh import of
// runtime/ssr.ts from source (which would be a second, disconnected
// copy — the exact mistake server/dev.ts's own header comment warns
// about for the dev/Vite-module-graph case). dist/server/_runtime.js is
// a stable, unhashed entry point server/build.ts adds specifically so
// this file has one fixed import path into that shared chunk.
const runtime: {
  beginRender<T>(fn: () => T): T;
  endRender(): { islands: IslandRef[]; styles: Set<string> };
  renderToHtml(target: unknown, props?: Record<string, unknown>): Promise<string>;
} = await import(pathToFileUrl(path.join(distDir, 'server', '_runtime.js')));

/* ------------------------------------------------------------------ */
/* Static file serving                                                 */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(res: http.ServerResponse, file: string, status = 200): void {
  const ext = path.extname(file);
  res.writeHead(status, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ */
/* Manifest route matching — same specificity rules as router/router.ts */
/* (static beats dynamic beats catch-all), applied against the small,   */
/* already-enumerated manifest route list instead of walking the       */
/* filesystem again.                                                    */
/* ------------------------------------------------------------------ */

interface MatchResult {
  entry: DynamicRouteManifestEntry;
  params: Record<string, string | string[]>;
}

function matchDynamic(pathname: string): MatchResult | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const candidates = manifest.routes.filter((r): r is DynamicRouteManifestEntry => r.type === 'dynamic');

  // Specificity: static segments beat dynamic beat catch-all, same as
  // router/router.ts's collectRoutes() sort.
  const scored = candidates
    .map((entry) => {
      const segments = entry.pathname.split('/').filter(Boolean);
      const catchAll = segments[segments.length - 1]?.startsWith('[...') ?? false;
      const dynamicCount = segments.filter((s) => s.startsWith('[')).length;
      return { entry, segments, catchAll, dynamicCount };
    })
    .sort((a, b) => {
      if (a.catchAll !== b.catchAll) return a.catchAll ? 1 : -1;
      return a.dynamicCount - b.dynamicCount;
    });

  outer: for (const { entry, segments, catchAll } of scored) {
    const params: Record<string, string | string[]> = {};
    if (catchAll) {
      const staticLen = segments.length - 1;
      if (parts.length < staticLen) continue;
      for (let i = 0; i < staticLen; i++) {
        if (segments[i] !== parts[i]) continue outer;
      }
      const name = segments[staticLen].slice(4, -1);
      params[name] = parts.slice(staticLen);
    } else {
      if (segments.length !== parts.length) continue;
      for (let i = 0; i < parts.length; i++) {
        const seg = segments[i];
        const dyn = seg.match(/^\[(.+)\]$/);
        if (dyn) params[dyn[1]] = parts[i];
        else if (seg !== parts[i]) continue outer;
      }
    }
    return { entry, params };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Module loading — plain Node import(), no Vite                       */
/* ------------------------------------------------------------------ */

const moduleCache = new Map<string, Promise<any>>();
function loadModule(relPath: string): Promise<any> {
  let p = moduleCache.get(relPath);
  if (!p) {
    const abs = path.join(distDir, relPath);
    p = import(pathToFileUrl(abs));
    moduleCache.set(relPath, p);
  }
  return p;
}
function pathToFileUrl(p: string): string {
  return 'file://' + p.split(path.sep).join('/');
}

/* ------------------------------------------------------------------ */
/* Shell — same discipline as dev.ts's shell(), but resolves island     */
/* sources through the manifest's built asset URLs instead of a dev     */
/* `?import` specifier.                                                 */
/* ------------------------------------------------------------------ */

// Mirrors runtime/escape.ts's escapeAttr — data-src values were escaped
// with that function when the HTML was generated, so the search string
// must match post-escaping, not the raw src.
function escapeAttrForSearch(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// renderIsland() (runtime/ssr.ts) bakes the ORIGINAL compiled-in source
// path into data-src, unconditionally — the compiler is unchanged, so
// every render (static or request-time) produces the dev-shaped path.
// The production server must rewrite it to the real built asset URL
// before the HTML reaches the browser, exactly as server/build.ts does
// for pre-rendered static pages.
function rewriteIslandSrcs(html: string): string {
  let out = html;
  for (const [src, builtUrl] of Object.entries(manifest.islands)) {
    out = out.split(`data-src="${escapeAttrForSearch(src)}"`).join(`data-src="${escapeAttrForSearch(builtUrl)}"`);
  }
  return out;
}

function shell(body: string, islands: IslandRef[], styles: Set<string>): string {
  const css = [...styles].join('\n');
  const srcs = [...new Set(islands.map((i) => i.src))];
  // CRITICAL: the loader map must be keyed by the SAME value data-src
  // carries in the (about to be rewritten) body HTML — the built URL,
  // not the original compiled-in source. See build.ts's shell() for the
  // full explanation; this is the identical bug, fixed the identical way.
  const islandsScript = srcs.length
    ? `<script type="module">
import { hydrateIslands } from "/client/runtime.js";
hydrateIslands({
${srcs
  .map((s) => `  ${JSON.stringify(manifest.islands[s] ?? s)}: () => import(${JSON.stringify(manifest.islands[s] ?? s)}),`)
  .join('\n')}
});
</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Najm</title>
${css ? `<style>\n${css}\n</style>` : ''}
</head>
<body>
${body}
${islandsScript}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Request handling                                                    */
/* ------------------------------------------------------------------ */

http
  .createServer((req, res) => {
    void handle(req, res);
  })
  .listen(port, () => {
    console.log(`\n  ▲ najm — production server at http://localhost:${port}\n`);
  });

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  try {
    // 1. dist/client/* — hashed island chunks + the runtime bundle.
    if (pathname.startsWith('/client/')) {
      const file = path.join(distDir, pathname);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        serveFile(res, file);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 — asset not found');
      return;
    }

    // 2. Static routes — serve the pre-rendered HTML file directly.
    const staticEntry = manifest.routes.find(
      (r): r is StaticRouteManifestEntry => r.type === 'static' && r.pathname === pathname
    );
    if (staticEntry) {
      serveFile(res, path.join(distDir, staticEntry.htmlFile));
      return;
    }

    // 3. Dynamic (request-time) routes — compiled module, run through
    // the same pipeline dev.ts's renderPage() uses.
    const match = matchDynamic(pathname);
    if (!match) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 — no route matches ${pathname}`);
      return;
    }
    const { entry, params } = match;

    if (entry.middlewarePaths.length) {
      const modules: MiddlewareModule[] = await Promise.all(
        entry.middlewarePaths.map((p) => loadModule(p))
      );
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
      const result = await runMiddlewareChain(modules, { pathname, params, headers });
      if (result?.type === 'redirect') {
        res.writeHead(result.status ?? 302, { location: result.to });
        res.end();
        return;
      }
      if (result?.type === 'reject') {
        res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(result.body ?? `${result.status}`);
        return;
      }
    }

    const page = await loadModule(entry.modulePath);

    // RFC-0016: render runs inside beginRender()'s callback for an
    // isolated async context, safe under real concurrent requests —
    // see runtime/ssr.ts's header comment.
    const { body, islands, styles } = await runtime.beginRender(async () => {
      let body: string;
      body = await runtime.renderToHtml(page, { params, path: pathname });
      for (let i = entry.layoutPaths.length - 1; i >= 0; i--) {
        const layout = await loadModule(entry.layoutPaths[i]);
        body = await runtime.renderToHtml(layout, { params, path: pathname, children: body });
      }
      const ctx = runtime.endRender();
      return { body, islands: ctx.islands, styles: ctx.styles };
    });

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(rewriteIslandSrcs(body), islands, styles));
  } catch (err: any) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<pre style="padding:2rem;color:#c00">${String(err?.stack ?? err)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`);
  }
}
