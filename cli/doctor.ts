/**
 * najm doctor — setup diagnostics (RFC-0011)
 * =================================================================
 * A short, FIXED checklist, not a general analyzer: Node version,
 * package.json has a "najm" dependency (or this repo's own
 * local framework), src/pages/ exists, dist/manifest.json presence
 * before `najm preview` is attempted (informational, not a hard
 * failure), and dynamic routes excluded from static generation
 * surfaced as EXPECTED BEHAVIOR — reusing router/router.ts's
 * listRoutes() and the same static-eligibility classification
 * server/build.ts already has (mirrored here, not reimplemented as a
 * second source of truth beyond the one-line rule build.ts itself
 * documents: dynamic segments or middleware anywhere in the ancestor
 * chain disqualify a route from static generation).
 */
import fs from 'node:fs';
import path from 'node:path';
import { listRoutes } from '../router/router';
import type { RouteEntry } from '../router/router';

export interface DoctorCheck {
  ok: boolean;
  /** true for a non-failing, informational line (prefixed "i" not "x"). */
  info?: boolean;
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** true iff every non-informational check passed. */
  healthy: boolean;
}

/** Mirrors server/build.ts's classifyRoute() — same rule, not reimplemented as a second classifier. */
function classifyRoute(route: RouteEntry): 'static' | 'dynamic' {
  if (route.hasDynamicSegments) return 'dynamic';
  if (route.middlewares.length > 0) return 'dynamic';
  return 'static';
}

const MIN_NODE_MAJOR = 20;

export function runDoctor(root: string): DoctorResult {
  const checks: DoctorCheck[] = [];

  // 1. Node version.
  const nodeVersion = process.version; // "v22.10.0"
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  checks.push({
    ok: major >= MIN_NODE_MAJOR,
    message: major >= MIN_NODE_MAJOR
      ? `Node.js ${nodeVersion.slice(1)} (>= ${MIN_NODE_MAJOR} required)`
      : `Node.js ${nodeVersion.slice(1)} — >= ${MIN_NODE_MAJOR} required`,
  });

  // 2. package.json has a "najm" dependency, OR (for this
  // monorepo itself) the local framework's own directories are present.
  const pkgPath = path.join(root, 'package.json');
  let hasNajmDep = false;
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    hasNajmDep = 'najm' in deps;
  }
  const hasLocalFramework =
    fs.existsSync(path.join(root, 'compiler')) &&
    fs.existsSync(path.join(root, 'runtime')) &&
    fs.existsSync(path.join(root, 'router'));
  checks.push({
    ok: hasNajmDep || hasLocalFramework,
    message: hasNajmDep
      ? 'package.json has a "najm" dependency'
      : hasLocalFramework
        ? 'package.json has a "najm" dependency (local framework source found)'
        : 'package.json has no "najm" dependency',
  });

  // 3. src/pages/ exists.
  const pagesDir = path.join(root, 'src', 'pages');
  const pagesExist = fs.existsSync(pagesDir) && fs.statSync(pagesDir).isDirectory();
  checks.push({
    ok: pagesExist,
    message: pagesExist ? 'src/pages/ exists' : 'src/pages/ not found',
  });

  // 4. dist/manifest.json — informational unless truly absent, since a
  // fresh checkout legitimately hasn't built yet.
  const manifestPath = path.join(root, 'dist', 'manifest.json');
  const hasManifest = fs.existsSync(manifestPath);
  checks.push({
    ok: hasManifest,
    message: hasManifest
      ? 'dist/manifest.json found'
      : 'dist/ not found — run `najm build` before `najm preview`',
  });

  // 5. Dynamic routes excluded from static generation — informational,
  // not a failure (RFC-0008/build pipeline's documented, expected
  // behavior; doctor surfaces it so a first-time user doesn't mistake
  // it for a bug).
  if (pagesExist) {
    const routes = listRoutes(pagesDir);
    const dynamic = routes.filter((r) => classifyRoute(r) === 'dynamic');
    if (dynamic.length > 0) {
      checks.push({
        ok: true,
        info: true,
        message: `${dynamic.length} dynamic route(s) excluded from static generation (expected — request-time rendered): ${dynamic.map((r) => r.pathname).join(', ')}`,
      });
    }
  }

  const healthy = checks.filter((c) => !c.info).every((c) => c.ok);
  return { checks, healthy };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines = result.checks.map((c) => {
    const mark = c.info ? 'i' : c.ok ? '✓' : '✗';
    return `${mark} ${c.message}`;
  });
  return lines.join('\n');
}
