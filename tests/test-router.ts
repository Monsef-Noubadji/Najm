/**
 * Router test suite — RFC-0008. Exercises resolvePage() and
 * runMiddlewareChain() directly, independent of a running server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolvePage } from '../router/router';
import { runMiddlewareChain } from '../router/middleware';
import type { MiddlewareModule } from '../router/middleware';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Build a throwaway pages/ tree so this suite doesn't depend on src/pages'
// current contents (which may change independently of router behavior).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-router-test-'));
const write = (rel: string, content = '') => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

write('index.najm');
write('about.najm');
write('layout.najm');
write('greet/[name].najm');
write('greet/about.najm'); // static segment must win over [name]
write('docs/[...slug].najm');
write('docs/intro.najm'); // static segment must win over [...slug]
write('blog/layout.najm');
write('blog/index.najm');
write('blog/middleware.ts');

await test('static route resolves', () => {
  const m = resolvePage(root, '/about');
  assert.ok(m);
  assert.ok(m!.file.endsWith('about.najm'));
});

await test('index.najm resolves the directory path', () => {
  const m = resolvePage(root, '/');
  assert.ok(m);
  assert.ok(m!.file.endsWith('index.najm') && !m!.file.includes('blog'));
});

await test('dynamic segment captures a param', () => {
  const m = resolvePage(root, '/greet/ada');
  assert.ok(m);
  assert.ok(m!.file.endsWith(path.join('greet', '[name].najm')));
  assert.deepEqual(m!.params, { name: 'ada' });
});

await test('static segment beats a dynamic segment at the same position', () => {
  const m = resolvePage(root, '/greet/about');
  assert.ok(m);
  assert.ok(m!.file.endsWith(path.join('greet', 'about.najm')));
});

await test('catch-all segment captures remaining parts as an array', () => {
  const m = resolvePage(root, '/docs/a/b/c');
  assert.ok(m);
  assert.ok(m!.file.endsWith(path.join('docs', '[...slug].najm')));
  assert.deepEqual(m!.params, { slug: ['a', 'b', 'c'] });
});

await test('static segment beats a catch-all at the same position', () => {
  const m = resolvePage(root, '/docs/intro');
  assert.ok(m);
  assert.ok(m!.file.endsWith(path.join('docs', 'intro.najm')));
});

await test('layout.najm and middleware.ts are never routable pages themselves', () => {
  assert.equal(resolvePage(root, '/layout'), null);
  assert.equal(resolvePage(root, '/blog/middleware'), null);
});

await test('layouts collect outermost-first down the directory ancestry', () => {
  const m = resolvePage(root, '/blog');
  assert.ok(m);
  assert.deepEqual(m!.layouts, [
    path.join(root, 'layout.najm'),
    path.join(root, 'blog', 'layout.najm'),
  ]);
});

await test('a route with no layouts/middleware in its own directory still inherits the root layout', () => {
  const m = resolvePage(root, '/about');
  assert.ok(m);
  assert.deepEqual(m!.middlewares, []);
  assert.deepEqual(m!.layouts, [path.join(root, 'layout.najm')]);
});

await test('middleware is scoped to its own directory and does not leak to siblings', () => {
  const m = resolvePage(root, '/about');
  assert.ok(m);
  assert.deepEqual(m!.middlewares, []);
});

await test('middleware collects for a route inside the directory that declares it', () => {
  const m = resolvePage(root, '/blog');
  assert.ok(m);
  assert.deepEqual(m!.middlewares, [path.join(root, 'blog', 'middleware.ts')]);
});

await test('unmatched route resolves to null', () => {
  assert.equal(resolvePage(root, '/nope/nope/nope'), null);
});

fs.rmSync(root, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* Middleware chain                                                    */
/* ------------------------------------------------------------------ */

const ctx = { pathname: '/x', params: {}, headers: {} };

function mw(fn: MiddlewareModule['default']): MiddlewareModule {
  return { default: fn };
}

await test('middleware chain: all "next" results in null (render proceeds)', async () => {
  const result = await runMiddlewareChain(
    [mw(() => ({ type: 'next' })), mw(() => undefined)],
    ctx
  );
  assert.equal(result, null);
});

await test('middleware chain: a redirect short-circuits later middleware', async () => {
  let thirdRan = false;
  const result = await runMiddlewareChain(
    [
      mw(() => ({ type: 'next' })),
      mw(() => ({ type: 'redirect', to: '/login' })),
      mw(() => {
        thirdRan = true;
        return { type: 'next' };
      }),
    ],
    ctx
  );
  assert.deepEqual(result, { type: 'redirect', to: '/login' });
  assert.equal(thirdRan, false);
});

await test('middleware chain: a reject short-circuits and carries status/body', async () => {
  const result = await runMiddlewareChain(
    [mw(() => ({ type: 'reject', status: 403, body: 'nope' }))],
    ctx
  );
  assert.deepEqual(result, { type: 'reject', status: 403, body: 'nope' });
});

await test('middleware chain: async middleware is awaited in order', async () => {
  const log: number[] = [];
  const result = await runMiddlewareChain(
    [
      mw(async () => {
        await new Promise((r) => setTimeout(r, 5));
        log.push(1);
        return { type: 'next' };
      }),
      mw(() => {
        log.push(2);
        return { type: 'next' };
      }),
    ],
    ctx
  );
  assert.equal(result, null);
  assert.deepEqual(log, [1, 2]);
});

console.log(`\nrouter: all ${passed} tests passed`);
