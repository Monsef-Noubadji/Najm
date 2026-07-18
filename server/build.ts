/**
 * Najm production build — server/build.ts
 * =================================================================
 * Dev mode (server/dev.ts) compiles .najm files live, on every request,
 * via Vite's transform middleware. That's fine for a dev server; it's a
 * real per-request cost with no benefit once nothing on disk is
 * changing. This script produces the on-disk artifacts a production
 * server can serve/execute directly, with NO Vite involved at request
 * time:
 *
 *   dist/static/*.html   pre-rendered HTML for routes that qualify
 *                        (see classifyRoute() below)
 *   dist/server/         compiled SSR modules (plain Node ESM) for
 *                        every page/layout/middleware, for routes that
 *                        must still render per-request
 *   dist/client/         hashed client chunks, one per distinct island
 *                        component actually used across all pages —
 *                        RFC-0007's "only that page's islands' JS"
 *                        guarantee, preserved as real built assets
 *   dist/manifest.json   route table + island source→asset mapping
 *
 * Route classification (scope decision, not relitigated here): a route
 * is static-eligible only if it has NO dynamic path segments (no
 * static-paths enumeration mechanism exists — router/router.ts's
 * listRoutes() lists a dynamic route once, as its own pattern, never
 * expanded) and NO middleware anywhere in its ancestor chain (middleware
 * must run per-request). Everything else still gets compiled for
 * request-time rendering, just not pre-rendered to HTML.
 *
 * The render pipeline used for static generation is the SAME one dev
 * mode uses (beginRender/renderToHtml/endRender/layout fold/shell),
 * driven through a build-time Vite server's ssrLoadModule — same
 * compiler (compiler/plugin.ts, unchanged), same runtime module
 * instance discipline dev.ts documents (fetch runtime through the Vite
 * SSR module graph, not a second disconnected import).
 */
import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build as viteBuild, createServer as createViteServer, loadConfigFromFile } from 'vite';
import type { InlineConfig } from 'vite';
import { najm } from '../compiler/plugin';
import { listRoutes } from '../router/router';
import type { RouteEntry } from '../router/router';
import type { IslandRef } from '../runtime/ssr';

// NAJM_APP_ROOT lets a build target an app tree other than this repo's own
// src/pages/ (e.g. benchmarks/fixtures/ — see RFC-0014) while still using
// this repo's compiler/runtime. Unset in every normal invocation (najm
// build, npm run build), so default behavior is completely unchanged.
const root = process.env.NAJM_APP_ROOT ? path.resolve(process.env.NAJM_APP_ROOT) : process.cwd();
const pagesDir = path.join(root, 'src', 'pages');
const distDir = path.join(root, 'dist');
const publishedRuntime = fileURLToPath(import.meta.resolve('@monsef-nbj/najm/core'));
const sourceRuntime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'index.ts');
const runtimeIndex = existsSync(publishedRuntime) ? publishedRuntime : sourceRuntime;
const buildStartedAt = performance.now();

const aliases = [
  { find: '@monsef-nbj/najm/core', replacement: runtimeIndex },
];
const loadedConfig = await loadConfigFromFile({ command: 'build', mode: 'production' }, undefined, root);
const hasConfiguredNajm = loadedConfig?.config.plugins?.some((plugin: any) => plugin?.name === 'vite-plugin-najm') ?? false;
const compilerPlugins = hasConfiguredNajm ? [] : [najm()];

/* ------------------------------------------------------------------ */
/* Manifest shape — written to dist/manifest.json                      */
/* ------------------------------------------------------------------ */

interface StaticRouteManifestEntry {
  type: 'static';
  pathname: string;
  htmlFile: string; // relative to dist/, e.g. "static/index.html"
}

interface DynamicRouteManifestEntry {
  type: 'dynamic';
  pathname: string;
  hasDynamicSegments: boolean;
  /** Compiled page module, relative to dist/, e.g. "server/pages/greet/[name].js" */
  modulePath: string;
  /** Compiled layout modules, outermost to innermost, relative to dist/. */
  layoutPaths: string[];
  /** Compiled middleware modules, outermost to innermost, relative to dist/. */
  middlewarePaths: string[];
}

type RouteManifestEntry = StaticRouteManifestEntry | DynamicRouteManifestEntry;

interface Manifest {
  routes: RouteManifestEntry[];
  /** Island source URL (as baked into SSR output, e.g.
   *  "/src/components/TodoList.najm") → built client asset URL
   *  (e.g. "/client/TodoList.abc123.js"), root-relative for the
   *  production server to serve directly. */
  islands: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Route classification                                                */
/* ------------------------------------------------------------------ */

function classifyRoute(route: RouteEntry): 'static' | 'dynamic' {
  if (route.hasDynamicSegments) return 'dynamic';
  if (route.middlewares.length > 0) return 'dynamic';
  return 'static';
}

function rootUrl(file: string): string {
  return '/' + path.relative(root, file).split(path.sep).join('/');
}

function formatDuration(ms: number): string {
  return ms < 100 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`;
}

/**
 * Deterministic, filesystem-safe Rollup entry name for a page/layout/
 * middleware file, relative to pagesDir. `[`/`]` (dynamic segments) are
 * not safe in every output path Rollup/the OS will accept the same way
 * across entry-name derivation vs. actual emitted file, so this is the
 * SINGLE place that mapping happens — both serverEntries (fed to Vite)
 * and the manifest's modulePath/layoutPaths/middlewarePaths (read by
 * server/serve.ts) call this, so they can never disagree.
 */
function entryNameFor(file: string): string {
  const rel = path.relative(pagesDir, file).split(path.sep).join('/');
  return rel.replace(/\.(najm|ts)$/, '').replace(/\[\.\.\.(.+?)\]/g, '__$1').replace(/\[(.+?)\]/g, '_$1_');
}

/* ------------------------------------------------------------------ */
/* Step 1: classify every route                                        */
/* ------------------------------------------------------------------ */

const routes = listRoutes(pagesDir);
const staticRoutes = routes.filter((r) => classifyRoute(r) === 'static');
const dynamicRoutes = routes.filter((r) => classifyRoute(r) === 'dynamic');

console.log(`\n  najm build — ${routes.length} route(s) found`);
console.log(`    static:  ${staticRoutes.map((r) => r.pathname).join(', ') || '(none)'}`);
console.log(`    dynamic: ${dynamicRoutes.map((r) => r.pathname).join(', ') || '(none)'}\n`);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Step 2: render every route once (build-time Vite SSR server) to     */
/* discover islands AND to produce static routes' HTML.                */
/* ------------------------------------------------------------------ */

const buildVite = await createViteServer({
  root,
  appType: 'custom',
  plugins: compilerPlugins,
  resolve: { alias: aliases },
  server: { middlewareMode: true, hmr: false },
});

const runtime: any = await buildVite.ssrLoadModule(rootUrl(runtimeIndex));

/** All distinct island sources referenced anywhere, across ALL routes
 *  (static and dynamic) — a dynamic route's page still needs its
 *  islands' client chunks built, even though the page itself isn't
 *  pre-rendered. */
const allIslandSrcs = new Set<string>();

interface RenderedStatic {
  route: RouteEntry;
  body: string;
  islands: IslandRef[];
  styles: Set<string>;
}
const renderedStatics: RenderedStatic[] = [];
const routeRenderTimes = new Map<string, number>();

async function renderRoute(route: RouteEntry): Promise<{ body: string; islands: IslandRef[]; styles: Set<string> }> {
  const pageUrl = rootUrl(route.file);
  const page: any = await buildVite.ssrLoadModule(pageUrl);

  // RFC-0016: render runs inside beginRender()'s callback for an
  // isolated async context — see runtime/ssr.ts's header comment.
  return runtime.beginRender(async () => {
    let body: string;
    body = await runtime.renderToHtml(page, { params: {}, path: route.pathname });
    for (let i = route.layouts.length - 1; i >= 0; i--) {
      const layoutUrl = rootUrl(route.layouts[i]);
      const layout: any = await buildVite.ssrLoadModule(layoutUrl);
      body = await runtime.renderToHtml(layout, {
        params: {},
        path: route.pathname,
        children: body,
      });
    }
    const ctx = runtime.endRender();
    return { body, islands: ctx.islands, styles: ctx.styles };
  });
}

for (const route of staticRoutes) {
  const startedAt = performance.now();
  const { body, islands, styles } = await renderRoute(route);
  routeRenderTimes.set(route.pathname, performance.now() - startedAt);
  for (const isl of islands) allIslandSrcs.add(isl.src);
  renderedStatics.push({ route, body, islands, styles });
}

// Dynamic routes aren't pre-rendered, but their islands still need
// client chunks. We can't render a dynamic-segment route (no concrete
// param value — see router/router.ts's header comment), so island
// discovery for those falls back to a static source scan of the page
// module's compiled ssr() output: render.ssr() with an EMPTY prop set
// still executes template-independent renderIsland() calls (island
// includes aren't conditioned on params in any of this repo's
// fixtures), so we render every dynamic route too and treat any thrown
// error as "couldn't discover islands this way" — non-fatal for the
// build, since the route still compiles for request-time rendering.
for (const route of dynamicRoutes) {
  const startedAt = performance.now();
  try {
    const { islands } = await renderRoute(route);
    for (const isl of islands) allIslandSrcs.add(isl.src);
  } catch {
    // Expected for routes whose render depends on real params/middleware
    // (e.g. /admin needs a header, /greet/[name] needs a concrete name).
    // Island discovery for these is best-effort; the compiled module is
    // still produced below for request-time rendering either way.
  } finally {
    routeRenderTimes.set(route.pathname, performance.now() - startedAt);
  }
}

await buildVite.close();

/* ------------------------------------------------------------------ */
/* Step 3: ship the runtime's hydrateIslands() (and everything else    */
/* najm/core exports) as its OWN client asset, built FIRST so the      */
/* island chunk build below can treat it as an external dependency     */
/* instead of bundling a second, disconnected copy.                    */
/*                                                                      */
/* CRITICAL, found live during browser verification: if each island's  */
/* client chunk bundles its own private copy of najm/core (the naive   */
/* approach — same plugin/alias as every other build step here), the   */
/* island's signal()/onMounted() calls close over THAT copy's module-  */
/* scoped state (runtime/lifecycle.ts's `current` instance pointer),   */
/* while hydrateIslands()'s mountComponent()/runWithInstance() close    */
/* over dist/client/runtime.js's SEPARATE copy — two disconnected      */
/* module graphs. The browser threw "onMounted() called outside        */
/* component setup" because the instance runWithInstance() set in one  */
/* copy was invisible to onMounted() reading `current` in the other.   */
/* The fix: build runtime.js once, then mark najm/core EXTERNAL in the */
/* island build and rewrite the import specifier to this file's real   */
/* URL (output.paths) — every island shares the exact same runtime     */
/* module instance in the browser, the same way dist/server/*.js pages */
/* share ONE instance via Rollup's shared-chunk factoring (Step 5).    */
/* ------------------------------------------------------------------ */

await viteBuild({
  root,
  resolve: { alias: aliases },
  build: {
    outDir: path.join(distDir, 'client'),
    emptyOutDir: true,
    // Library mode: without it, Rollup's default "app" build tree-shakes
    // every export nothing in this isolated build graph consumes (there's
    // no HTML entry importing hydrateIslands here) and produces an empty
    // chunk — also caught live during verification (dist/client/runtime.js
    // shipped with zero exports, and the browser's dynamic import of
    // hydrateIslands from it threw). Library mode preserves the full
    // named-export surface of runtimeIndex as the file's public API.
    lib: {
      entry: runtimeIndex,
      formats: ['es'],
      fileName: () => 'runtime.js',
    },
    target: 'es2022',
  },
  logLevel: 'warn',
});

/* ------------------------------------------------------------------ */
/* Step 4: build client chunks — one entry point per distinct island.  */
/* Vite's build output keeps them as separate hashed files as long as  */
/* each is its own rollup entry (no manualChunks merging requested).   */
/* najm/core is external here (see Step 3's comment) — resolved to the */
/* literal runtime.js URL the browser will actually fetch.             */
/* ------------------------------------------------------------------ */

const islandManifest: Record<string, string> = {};

if (allIslandSrcs.size > 0) {
  const islandEntries: Record<string, string> = {};
  for (const src of allIslandSrcs) {
    // '/src/components/TodoList.najm' -> entry name 'TodoList'
    const name = path.basename(src).replace(/\.[^.]+$/, '');
    islandEntries[name] = path.join(root, src.replace(/^\//, ''));
  }

  const clientConfig: InlineConfig = {
    root,
    plugins: compilerPlugins,
    resolve: { alias: aliases },
    build: {
      outDir: path.join(distDir, 'client'),
      emptyOutDir: false, // runtime.js (Step 3) already lives here
      manifest: 'client-manifest.json',
      // Library mode, same reasoning as Step 3: a default "app" build
      // tree-shakes an entry's exports when nothing in the isolated
      // build graph consumes them (an island's hydrate()/ssr() aren't
      // called by anything else in this build — the browser calls them
      // dynamically, at request time, via hydrateIslands()'s dynamic
      // import()). Without lib mode this silently produced EMPTY chunk
      // files (a real, 200-status asset that hydrated nothing).
      lib: {
        entry: islandEntries,
        formats: ['es'],
        fileName: (_format, entryName) => `assets/${entryName}.[hash].js`,
      },
      rollupOptions: {
        // runtimeIndex is the resolved absolute path 'najm/core' aliases
        // to — mark THAT external (not the specifier string 'najm/core',
        // which nothing here still uses post-alias-resolution).
        external: [runtimeIndex],
        output: {
          // one chunk per entry, no shared-vendor merging — every page
          // fetches only the islands it actually uses (RFC-0007).
          chunkFileNames: 'assets/[name].[hash].js',
          paths: { [runtimeIndex]: '/client/runtime.js' },
        },
      },
    },
    logLevel: 'warn',
  };
  await viteBuild(clientConfig);

  const rollupManifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'client', 'client-manifest.json'), 'utf8')
  );
  for (const src of allIslandSrcs) {
    const name = path.basename(src).replace(/\.[^.]+$/, '');
    // Rollup manifest keys entries by their input path relative to root.
    const relInput = src.replace(/^\//, '');
    const entry = rollupManifest[relInput];
    if (!entry) {
      throw new Error(`[najm build] no client-manifest entry found for island ${src} (entry name ${name})`);
    }
    islandManifest[src] = '/client/' + entry.file;
  }
}

/* ------------------------------------------------------------------ */
/* Step 5: build server modules — every page/layout/middleware, plain  */
/* Node ESM output. `najm/core` is bundled IN (not external) so each   */
/* dist/server/*.js file is self-contained and importable via plain    */
/* Node `import()` with no module-resolution setup on the production   */
/* server's side. Rollup automatically factors the shared runtime code */
/* every entry point imports into a shared chunk (dist/server/assets/  */
/* ssr-*.hash.js etc.) rather than duplicating it per page — which     */
/* means every compiled page's renderIsland()/registerStyle() calls    */
/* already write into ONE shared module instance. server/serve.ts      */
/* needs to drive beginRender()/endRender()/renderToHtml() through      */
/* that SAME instance, not a fresh import of runtime/ssr.ts from        */
/* source (which would be a second, disconnected module — the exact    */
/* mistake dev.ts's own header comment warns about for the dev case).  */
/* A stable, unhashed extra entry point (`_runtime`) re-exports the     */
/* pipeline functions from the identical shared chunk Rollup already    */
/* produced, giving serve.ts one fixed import path into it.            */
/* ------------------------------------------------------------------ */

const allServerFiles = new Set<string>();
for (const route of routes) {
  allServerFiles.add(route.file);
  for (const l of route.layouts) allServerFiles.add(l);
  for (const m of route.middlewares) allServerFiles.add(m);
}
// SafeCrasher.ts-style non-.najm component includes and other same-dir
// deps are pulled in by Rollup's module graph automatically; we only
// need to seed entry points for files the router itself names.

const serverEntries: Record<string, string> = {};
for (const file of allServerFiles) {
  serverEntries[entryNameFor(file)] = file;
}

// Stable entry point serve.ts imports the render pipeline through — see
// the comment block above. Content is trivial: just re-exports the
// pipeline surface from runtime/index.ts, resolved through the SAME
// `najm/core` alias every page entry point resolves it through, so
// Rollup's chunk-sharing puts it in the same shared chunk.
const runtimeEntryFile = path.join(distDir, '.build-tmp-runtime-entry.ts');
fs.writeFileSync(
  runtimeEntryFile,
  `export { beginRender, endRender, renderToHtml } from ${JSON.stringify(runtimeIndex)};\n`,
  'utf8'
);
serverEntries['_runtime'] = runtimeEntryFile;

const serverConfig: InlineConfig = {
  root,
  plugins: compilerPlugins,
  resolve: { alias: aliases },
  build: {
    outDir: path.join(distDir, 'server'),
    emptyOutDir: true,
    ssr: true,
    ssrEmitAssets: false,
    rollupOptions: {
      input: serverEntries,
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
      // najm/core resolves to runtime/index.ts via the alias above, so
      // it's bundled in (not left as a bare specifier the production
      // server would need to resolve) — dist/server/ modules are
      // self-contained plain ESM, importable via plain `import()`.
      external: [],
    },
    target: 'node18',
  },
  logLevel: 'warn',
};
await viteBuild(serverConfig);
fs.rmSync(runtimeEntryFile, { force: true });

/* ------------------------------------------------------------------ */
/* Step 6: rewrite island data-src → built asset URL in static HTML,   */
/* wrap in the shell (same discipline as dev.ts's shell()), and write. */
/* ------------------------------------------------------------------ */

function rewriteIslandSrcs(html: string): string {
  let out = html;
  for (const [src, builtUrl] of Object.entries(islandManifest)) {
    out = out.split(`data-src="${escapeAttrForSearch(src)}"`).join(`data-src="${escapeAttrForSearch(builtUrl)}"`);
  }
  return out;
}

// Mirrors runtime/escape.ts's escapeAttr — data-src values were escaped
// with that function when the HTML was generated, so the search string
// must match post-escaping, not the raw src.
function escapeAttrForSearch(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function shell(body: string, islands: IslandRef[], styles: Set<string>): string {
  const css = [...styles].join('\n');
  const srcs = [...new Set(islands.map((i) => i.src))];
  // CRITICAL: runtime/client.ts's hydrateIslands() looks up
  // loaders[el.getAttribute('data-src')] — and the HTML's data-src has
  // ALREADY been rewritten (see rewriteIslandSrcs()) from the original
  // compiled-in source path to the real built asset URL. The loader map
  // must therefore be keyed by that SAME built URL, not the original
  // source — keying by the original source here silently no-ops every
  // island's hydration (loaders[builtUrl] undefined), caught live during
  // browser verification: no thrown error, no console output, the
  // island just never hydrates.
  const islandsScript = srcs.length
    ? `<script type="module">
import { hydrateIslands } from "/client/runtime.js";
hydrateIslands({
${srcs
  .map((s) => `  ${JSON.stringify(islandManifest[s] ?? s)}: () => import(${JSON.stringify(islandManifest[s] ?? s)}),`)
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

const staticDir = path.join(distDir, 'static');
fs.mkdirSync(staticDir, { recursive: true });

const routeManifestEntries: RouteManifestEntry[] = [];

for (const { route, body, islands, styles } of renderedStatics) {
  const html = shell(body, islands, styles);
  const outRel = route.pathname === '/' ? 'index.html' : `${route.pathname.replace(/^\//, '')}.html`;
  const outFile = path.join(staticDir, outRel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');
  routeManifestEntries.push({
    type: 'static',
    pathname: route.pathname,
    htmlFile: 'static/' + outRel.split(path.sep).join('/'),
  });
  const renderTime = formatDuration(routeRenderTimes.get(route.pathname) ?? 0);
  console.log(`  ✓ static  ${route.pathname.padEnd(24)} -> dist/${'static/' + outRel.split(path.sep).join('/')}  ${renderTime}`);
}

for (const route of dynamicRoutes) {
  const modulePath = `server/${entryNameFor(route.file)}.js`;
  const layoutPaths = route.layouts.map((l) => `server/${entryNameFor(l)}.js`);
  const middlewarePaths = route.middlewares.map((m) => `server/${entryNameFor(m)}.js`);
  routeManifestEntries.push({
    type: 'dynamic',
    pathname: route.pathname,
    hasDynamicSegments: route.hasDynamicSegments,
    modulePath,
    layoutPaths,
    middlewarePaths,
  });
  const renderTime = formatDuration(routeRenderTimes.get(route.pathname) ?? 0);
  console.log(`  ✓ dynamic ${route.pathname.padEnd(24)} -> dist/${modulePath} (request-time render)  ${renderTime}`);
}

/* ------------------------------------------------------------------ */
/* Step 7: rewrite data-src in the already-written static HTML files   */
/* (the shell() above already used islandManifest for the bootstrap    */
/* script, but the SSR'd <najm-island> wrapper markup itself also      */
/* carries data-src="..." baked in by runtime/ssr.ts's renderIsland(), */
/* unconditionally — it must point at the same built URL).             */
/* ------------------------------------------------------------------ */

for (const entry of routeManifestEntries) {
  if (entry.type !== 'static') continue;
  const file = path.join(distDir, entry.htmlFile);
  const html = fs.readFileSync(file, 'utf8');
  const rewritten = rewriteIslandSrcs(html);
  if (rewritten !== html) fs.writeFileSync(file, rewritten, 'utf8');
}

/* ------------------------------------------------------------------ */
/* Step 8: manifest.json                                               */
/* ------------------------------------------------------------------ */

const manifest: Manifest = {
  routes: routeManifestEntries,
  islands: islandManifest,
};
fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n  ▲ najm build complete in ${formatDuration(performance.now() - buildStartedAt)} — dist/manifest.json written (${routeManifestEntries.length} routes, ${Object.keys(islandManifest).length} island chunk(s))\n`);
