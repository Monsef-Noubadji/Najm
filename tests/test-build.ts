/**
 * Build pipeline test suite — production build (server/build.ts).
 *
 * Exercises route classification (static-eligible vs. request-time-only)
 * against a throwaway pages/ tree, independent of running a real Vite
 * build (which is slow and I/O heavy — the real end-to-end build is
 * verified manually per the build pipeline's own report, not re-run
 * here on every `npm test`). Also checks the manifest shape a real
 * `npm run build` produces is well-formed, by running the actual build
 * once against the real src/pages fixtures and inspecting dist/manifest.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listRoutes } from '../router/router';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ------------------------------------------------------------------ */
/* Route classification — mirrors server/build.ts's classifyRoute()    */
/* ------------------------------------------------------------------ */

function classify(route: { hasDynamicSegments: boolean; middlewares: string[] }): 'static' | 'dynamic' {
  if (route.hasDynamicSegments) return 'dynamic';
  if (route.middlewares.length > 0) return 'dynamic';
  return 'static';
}

// Throwaway pages/ tree, independent of src/pages' current contents —
// same discipline as tests/test-router.ts.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-build-test-'));
const write = (rel: string, content = '') => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

write('index.najm');
write('about.najm');
write('greet/[name].najm');
write('docs/[...slug].najm');
write('admin/index.najm');
write('admin/middleware.ts');
write('blog/layout.najm');
write('blog/index.najm');

const routes = listRoutes(root);
const byPathname = new Map(routes.map((r) => [r.pathname, r]));

test('listRoutes() enumerates every page route, excluding structural files', () => {
  const pathnames = routes.map((r) => r.pathname).sort();
  assert.deepEqual(pathnames, [
    '/',
    '/about',
    '/admin',
    '/blog',
    '/docs/[...slug]',
    '/greet/[name]',
  ].sort());
});

test('a static route with no dynamic segments and no middleware is static-eligible', () => {
  const route = byPathname.get('/about');
  assert.ok(route);
  assert.equal(route!.hasDynamicSegments, false);
  assert.equal(classify(route!), 'static');
});

test('a dynamic-segment route ([name]) is NOT static-eligible', () => {
  const route = byPathname.get('/greet/[name]');
  assert.ok(route);
  assert.equal(route!.hasDynamicSegments, true);
  assert.equal(classify(route!), 'dynamic');
});

test('a catch-all route ([...slug]) is NOT static-eligible', () => {
  const route = byPathname.get('/docs/[...slug]');
  assert.ok(route);
  assert.equal(route!.hasDynamicSegments, true);
  assert.equal(classify(route!), 'dynamic');
});

test('a middleware-guarded route (/admin) is NOT static-eligible even with no dynamic segments', () => {
  const route = byPathname.get('/admin');
  assert.ok(route);
  assert.equal(route!.hasDynamicSegments, false);
  assert.ok(route!.middlewares.length > 0);
  assert.equal(classify(route!), 'dynamic');
});

test('a route under a layout but with no middleware is still static-eligible', () => {
  const route = byPathname.get('/blog');
  assert.ok(route);
  assert.equal(route!.hasDynamicSegments, false);
  assert.deepEqual(route!.middlewares, []);
  assert.equal(classify(route!), 'static');
});

fs.rmSync(root, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* Manifest shape — run the real build once against src/pages and      */
/* inspect the actual dist/manifest.json it produces.                  */
/* ------------------------------------------------------------------ */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('npm run build produces a well-formed dist/manifest.json', () => {
  // shell: true — on Windows, npx resolves to npx.cmd, which
  // execFileSync cannot exec directly without going through a shell.
  execFileSync('npx tsx server/build.ts', { cwd: repoRoot, stdio: 'pipe', shell: true });

  const manifestPath = path.join(repoRoot, 'dist', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'dist/manifest.json was not written');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(Array.isArray(manifest.routes), 'manifest.routes must be an array');
  assert.ok(manifest.routes.length > 0, 'manifest.routes must be non-empty for this repo\'s fixtures');
  assert.ok(
    typeof manifest.islands === 'object' && manifest.islands !== null,
    'manifest.islands must be an object'
  );

  for (const entry of manifest.routes) {
    assert.ok(typeof entry.pathname === 'string' && entry.pathname.startsWith('/'), 'every route entry needs a pathname');
    if (entry.type === 'static') {
      assert.ok(typeof entry.htmlFile === 'string' && entry.htmlFile.startsWith('static/'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'dist', entry.htmlFile)), `${entry.htmlFile} referenced by manifest but missing on disk`);
    } else if (entry.type === 'dynamic') {
      assert.ok(typeof entry.modulePath === 'string' && entry.modulePath.startsWith('server/'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'dist', entry.modulePath)), `${entry.modulePath} referenced by manifest but missing on disk`);
      assert.ok(Array.isArray(entry.layoutPaths));
      assert.ok(Array.isArray(entry.middlewarePaths));
    } else {
      assert.fail(`unknown manifest route entry type: ${entry.type}`);
    }
  }

  for (const [src, builtUrl] of Object.entries(manifest.islands)) {
    assert.ok(typeof src === 'string' && src.startsWith('/'), 'island source key must be root-relative');
    assert.ok(typeof builtUrl === 'string' && (builtUrl as string).startsWith('/client/'), 'island built URL must live under /client/');
  }
});

test('the /about route (no islands, no dynamic segments, no middleware) is classified static in the real build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));
  const about = manifest.routes.find((r: any) => r.pathname === '/about');
  assert.ok(about, '/about missing from manifest');
  assert.equal(about.type, 'static');
});

test('the /greet/[name] and /admin routes are classified dynamic (request-time) in the real build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));
  const greet = manifest.routes.find((r: any) => r.pathname === '/greet/[name]');
  const admin = manifest.routes.find((r: any) => r.pathname === '/admin');
  assert.ok(greet, '/greet/[name] missing from manifest');
  assert.ok(admin, '/admin missing from manifest');
  assert.equal(greet.type, 'dynamic');
  assert.equal(admin.type, 'dynamic');
});

console.log(`\nbuild: all ${passed} tests passed`);
