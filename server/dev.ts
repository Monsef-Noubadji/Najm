/**
 * Najm dev server — Phase 4
 * =================================================================
 * Node's http server with Vite in middleware mode. Division of labor:
 *
 *   Vite middleware — serves & transforms every module request
 *                     (.najm via our plugin, .ts via esbuild)
 *   the fallthrough — everything else is a PAGE request: resolve it
 *                     against src/pages, SSR it, wrap it in the shell.
 *
 * The shell is where the Astro discipline is enforced: collected
 * component styles are hoisted into <head>, and a script tag is
 * emitted ONLY when the render recorded islands. A page with no
 * islands is served as pure HTML — zero JavaScript, not "a small
 * runtime", zero.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, loadConfigFromFile } from 'vite';
import { najm } from '../compiler/plugin';
import { resolvePage } from '../router/router';
import { runMiddlewareChain } from '../router/middleware';
import type { MiddlewareModule } from '../router/middleware';
import type { IslandRef } from '../runtime/ssr';

const root = process.cwd();
const pagesDir = path.join(root, 'src', 'pages');
const port = Number(process.env.PORT ?? 3000);

const publishedRuntime = fileURLToPath(import.meta.resolve('@monsef-nbj/najm/core'));
const sourceRuntime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'index.ts');
const runtimeIndex = existsSync(publishedRuntime) ? publishedRuntime : sourceRuntime;
const loadedConfig = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, root);
const hasConfiguredNajm = loadedConfig?.config.plugins?.some((plugin: any) => plugin?.name === 'vite-plugin-najm') ?? false;

const vite = await createViteServer({
  root,
  appType: 'custom',
  plugins: hasConfiguredNajm ? [] : [najm()],
  resolve: {
    // Local aliases standing in for the published packages (see
    // packages/ for the npm distribution blueprints):
    //   najm/core          → najm
    // Interop with other frameworks happens at the Web Component
    // boundary (RFC-0002) — there is no in-process React/Vue runtime
    // bridge in Najm's core, so no dep pre-bundling for guest
    // frameworks belongs here.
    alias: [
      { find: '@monsef-nbj/najm/core', replacement: runtimeIndex },
    ],
  },
  server: { middlewareMode: true },
});

// CRITICAL: the render context must be the exact module instance the
// compiled pages import. Pages live in Vite's SSR module graph, so we
// fetch the runtime through that same graph — importing it directly
// into this process would give us a second, disconnected copy.
const runtimeUrl = '/' + path.relative(root, runtimeIndex).split(path.sep).join('/');
const runtime: any = await vite.ssrLoadModule(runtimeUrl);

http
  .createServer((req, res) => {
    vite.middlewares(req, res, () => {
      void renderPage(req, res);
    });
  })
  .listen(port, () => {
    console.log(`\n  ▲ najm — dev server at http://localhost:${port}\n`);
  });

async function renderPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    const match = resolvePage(pagesDir, url.pathname);
    if (!match) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 — no page in src/pages matches ${url.pathname}`);
      return;
    }

    // RFC-0008: middleware runs outermost-first, before the page ever
    // renders, and can redirect/reject the request outright.
    if (match.middlewares.length) {
      const modules: MiddlewareModule[] = await Promise.all(
        match.middlewares.map((file) => {
          const url = '/' + path.relative(root, file).split(path.sep).join('/');
          return vite.ssrLoadModule(url) as Promise<MiddlewareModule>;
        })
      );
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
      const result = await runMiddlewareChain(modules, {
        pathname: url.pathname,
        params: match.params,
        headers,
      });
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

    // Pull the page through the compiler and execute it in Node.
    const pageUrl = '/' + path.relative(root, match.file).split(path.sep).join('/');
    const page: any = await vite.ssrLoadModule(pageUrl);

    // RFC-0016: the entire render (including every layout fold) runs
    // INSIDE beginRender()'s callback — this is what gives it an
    // isolated async context for the whole request, safe under real
    // concurrent requests (see runtime/ssr.ts's header comment).
    const { body, islands, styles } = await runtime.beginRender(async () => {
      let body: string;
      // renderToHtml speaks both generations: functional pages (module
      // default export) and legacy SFC pages ({ ssr }).
      body = await runtime.renderToHtml(page, { params: match.params, path: url.pathname });

      // RFC-0008: fold the page through each layout, innermost to
      // outermost (match.layouts is outermost-first), passing the
      // previous stage's HTML as the `children` prop. A layout embeds
      // it via {@html children} — the raw, unescaped interpolation
      // primitive that exists specifically for trusted, framework-
      // produced HTML like this.
      for (let i = match.layouts.length - 1; i >= 0; i--) {
        const layoutUrl = '/' + path.relative(root, match.layouts[i]).split(path.sep).join('/');
        const layout: any = await vite.ssrLoadModule(layoutUrl);
        body = await runtime.renderToHtml(layout, {
          params: match.params,
          path: url.pathname,
          children: body,
        });
      }
      const ctx = runtime.endRender();
      return { body, islands: ctx.islands, styles: ctx.styles };
    });

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(body, islands, styles));
  } catch (err: any) {
    vite.ssrFixStacktrace?.(err);
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<pre style="padding:2rem;color:#c00">${String(err?.stack ?? err)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`);
  }
}

function shell(body: string, islands: IslandRef[], styles: Set<string>): string {
  const css = [...styles].join('\n');

  // The islands manifest for THIS response: one dynamic import per
  // distinct component actually on the page. No islands → no script.
  const srcs = [...new Set(islands.map((i) => i.src))];
  const islandsScript = srcs.length
    ? `<script type="module">
import { hydrateIslands } from ${JSON.stringify(runtimeUrl)};
hydrateIslands({
${srcs
  .map((s) => `  ${JSON.stringify(s)}: () => import(${JSON.stringify(s + '?import')}),`)
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
