/**
 * File-based routing — v1.0 Phase 3.2
 * =================================================================
 * The filesystem IS the route table (the Next.js insight that outlived
 * every client-side router):
 *
 *   src/pages/index.najm              →  /
 *   src/pages/about.najm              →  /about
 *   src/pages/blog/index.najm         →  /blog
 *   src/pages/greet/[name].najm       →  /greet/:name    (params.name)
 *   src/pages/docs/[...slug].najm     →  /docs/*         (params.slug, an array)
 *   src/pages/layout.najm             →  wraps EVERY page below it
 *   src/pages/blog/layout.najm        →  wraps pages under blog/ (nested
 *                                        inside the root layout, innermost-out)
 *   src/pages/middleware.ts           →  runs before EVERY page below it,
 *                                        can redirect/reject before render
 *
 * Routes are re-scanned per request in dev — adding a page is
 * instantly live, no restart, no route registration ceremony.
 * (Production builds precompute this table once; see README roadmap.)
 *
 * `layout.najm` and `middleware.ts` are structural files: they are
 * never routes themselves and are excluded from the page table, the
 * same way Next.js's App Router treats `layout.tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RouteMatch {
  file: string;
  params: Record<string, string | string[]>;
  /** Layout files from OUTERMOST to INNERMOST — the render order for nesting. */
  layouts: string[];
  /** Middleware files from OUTERMOST to INNERMOST — the execution order. */
  middlewares: string[];
}

/** One entry in the full route table — see listRoutes(). */
export interface RouteEntry {
  file: string;
  /** The route's own pathname, e.g. '/greet/[name]' — segments are NOT
   *  resolved against concrete params, since there is no
   *  static-paths-enumeration mechanism (see router/router.ts's header
   *  comment and RFC-0011's build pipeline scope decision). */
  pathname: string;
  /** True if any segment is `[param]` or `[...catchAll]`. */
  hasDynamicSegments: boolean;
  layouts: string[];
  middlewares: string[];
}

interface Route {
  file: string;
  dir: string;
  segments: string[];
  dynamicCount: number;
  catchAll: boolean;
}

const STRUCTURAL = new Set(['layout.najm', 'middleware.ts']);

function collectRoutes(pagesDir: string): Route[] {
  const routes: Route[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.najm') && !STRUCTURAL.has(entry.name)) {
        const rel = path.relative(pagesDir, full).split(path.sep).join('/');
        const segments = rel.replace(/\.najm$/, '').split('/');
        if (segments[segments.length - 1] === 'index') segments.pop();
        const catchAll = segments[segments.length - 1]?.startsWith('[...') ?? false;
        routes.push({
          file: full,
          dir: path.dirname(full),
          segments,
          dynamicCount: segments.filter((s) => s.startsWith('[')).length,
          catchAll,
        });
      }
    }
  };
  if (fs.existsSync(pagesDir)) walk(pagesDir);
  // Match specificity, most to least: static segments beat dynamic
  // segments beat catch-all — /docs/intro matches docs/intro.najm before
  // docs/[slug].najm before docs/[...slug].najm.
  return routes.sort((a, b) => {
    if (a.catchAll !== b.catchAll) return a.catchAll ? 1 : -1;
    return a.dynamicCount - b.dynamicCount;
  });
}

/** Every directory from `pagesDir` down to (and including) `dir`, outermost first. */
function ancestorDirs(pagesDir: string, dir: string): string[] {
  const rel = path.relative(pagesDir, dir);
  const parts = rel === '' ? [] : rel.split(path.sep);
  const dirs = [pagesDir];
  let acc = pagesDir;
  for (const part of parts) {
    acc = path.join(acc, part);
    dirs.push(acc);
  }
  return dirs;
}

/** Structural files (layout.najm / middleware.ts) found in each ancestor dir, outermost first. */
function collectStructural(pagesDir: string, dir: string, filename: string): string[] {
  const found: string[] = [];
  for (const d of ancestorDirs(pagesDir, dir)) {
    const candidate = path.join(d, filename);
    if (fs.existsSync(candidate)) found.push(candidate);
  }
  return found;
}

export function resolvePage(pagesDir: string, pathname: string): RouteMatch | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  outer: for (const route of collectRoutes(pagesDir)) {
    const params: Record<string, string | string[]> = {};

    if (route.catchAll) {
      const staticLen = route.segments.length - 1;
      if (parts.length < staticLen) continue;
      for (let i = 0; i < staticLen; i++) {
        if (route.segments[i] !== parts[i]) continue outer;
      }
      const name = route.segments[staticLen].slice(4, -1); // "[...slug]" → "slug"
      params[name] = parts.slice(staticLen);
    } else {
      if (route.segments.length !== parts.length) continue;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        const dyn = seg.match(/^\[(.+)\]$/);
        if (dyn) params[dyn[1]] = parts[i];
        else if (seg !== parts[i]) continue outer;
      }
    }

    return {
      file: route.file,
      params,
      layouts: collectStructural(pagesDir, route.dir, 'layout.najm'),
      middlewares: collectStructural(pagesDir, route.dir, 'middleware.ts'),
    };
  }
  return null;
}

/**
 * Every page route under pagesDir, with its pathname and ancestry
 * (layouts/middlewares) — the enumeration `resolvePage()` deliberately
 * doesn't provide (it takes one concrete pathname and returns one
 * match). Used by the build pipeline to classify routes as
 * static-eligible or request-time-only; NOT a static-paths mechanism —
 * a dynamic route (`[name]`) is listed once, as its own unresolved
 * pattern, not expanded into concrete URLs.
 */
export function listRoutes(pagesDir: string): RouteEntry[] {
  return collectRoutes(pagesDir).map((route) => ({
    file: route.file,
    pathname: '/' + route.segments.join('/'),
    hasDynamicSegments: route.segments.some((s) => s.startsWith('[')),
    layouts: collectStructural(pagesDir, route.dir, 'layout.najm'),
    middlewares: collectStructural(pagesDir, route.dir, 'middleware.ts'),
  }));
}
