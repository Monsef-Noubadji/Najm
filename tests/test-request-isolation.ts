/**
 * Request-isolation test suite — RFC-0016's Verification gate.
 *
 * Proves the concurrency bug found live during RFC-0016's authoring is
 * real (reproduced against the PRE-fix module-level `let ctx` design —
 * see this file's git-adjacent history / the RFC's Verification section
 * for the exact reproduction) and that the AsyncLocalStorage-based fix
 * in runtime/ssr.ts actually closes it: two concurrent, interleaved
 * beginRender()...endRender() calls never see each other's islands or
 * styles, no matter how their internal awaits interleave on the event
 * loop.
 */
import assert from 'node:assert/strict';
import { beginRender, endRender, registerStyle, renderIsland } from '../runtime/ssr';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const fakeComp = (label: string) => ({ ssr: async () => `<div>${label}</div>` });

await test('two concurrent renders with interleaving awaits never see each other\'s islands', async () => {
  async function request(label: string, islandCount: number, delayMs: number) {
    return beginRender(async () => {
      await new Promise((r) => setTimeout(r, delayMs)); // simulate async component work
      for (let i = 0; i < islandCount; i++) {
        await renderIsland(fakeComp(label), `/fake-${label}-${i}.najm`, {});
      }
      const ctx = endRender();
      return { label, srcs: ctx.islands.map((isl) => isl.src) };
    });
  }

  // Request A starts first, does MORE async work (higher delay), so
  // request B's beginRender() fires WHILE A is still suspended mid-await
  // — exactly the interleaving that broke the old module-level `let ctx`.
  const [a, b] = await Promise.all([request('A', 4, 40), request('B', 3, 5)]);

  assert.equal(a.srcs.length, 4, 'request A must see exactly its own 4 islands');
  assert.equal(b.srcs.length, 3, 'request B must see exactly its own 3 islands');
  assert.ok(a.srcs.every((s) => s.includes('-A-')), 'request A must never see a B-labeled island');
  assert.ok(b.srcs.every((s) => s.includes('-B-')), 'request B must never see an A-labeled island');
});

await test('styles registered during one request never leak into a concurrent request\'s context', async () => {
  async function request(label: string, css: string, delayMs: number) {
    return beginRender(async () => {
      registerStyle(css);
      await new Promise((r) => setTimeout(r, delayMs));
      registerStyle(css + '-again'); // a second style, after the delay/interleave point
      const ctx = endRender();
      return { label, styles: [...ctx.styles] };
    });
  }

  const [a, b] = await Promise.all([
    request('A', '.a{color:red}', 30),
    request('B', '.b{color:blue}', 5),
  ]);

  assert.equal(a.styles.length, 2, 'request A must see exactly its own 2 registered styles');
  assert.equal(b.styles.length, 2, 'request B must see exactly its own 2 registered styles');
  assert.ok(a.styles.includes('.a{color:red}') && a.styles.includes('.a{color:red}-again'));
  assert.ok(!a.styles.some((s) => s.startsWith('.b')), 'request A must never see request B\'s styles');
  assert.ok(b.styles.includes('.b{color:blue}') && b.styles.includes('.b{color:blue}-again'));
  assert.ok(!b.styles.some((s) => s.startsWith('.a')), 'request B must never see request A\'s styles');
});

await test('ten highly-interleaved concurrent renders each see exactly their own islands (stress case)', async () => {
  async function request(n: number) {
    return beginRender(async () => {
      // stagger delays so awaits interleave unpredictably across all ten
      await new Promise((r) => setTimeout(r, (n % 5) * 3));
      await renderIsland(fakeComp(`req${n}`), `/stress-${n}.najm`, {});
      await new Promise((r) => setTimeout(r, (10 - n) % 4));
      await renderIsland(fakeComp(`req${n}`), `/stress-${n}-b.najm`, {});
      const ctx = endRender();
      return { n, srcs: ctx.islands.map((isl) => isl.src) };
    });
  }

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => request(i)));
  for (const r of results) {
    assert.equal(r.srcs.length, 2, `request ${r.n} must see exactly 2 islands`);
    assert.ok(
      r.srcs.every((s) => s.includes(`-${r.n}.`) || s.includes(`-${r.n}-b.`)),
      `request ${r.n} must never see another request's island (got ${r.srcs.join(', ')})`
    );
  }
});

await test('endRender()/renderIsland()/registerStyle() called outside any beginRender() still fail loudly', async () => {
  assert.throws(() => endRender(), /outside beginRender/);
  await assert.rejects(
    () => renderIsland(fakeComp('x'), '/x.najm', {}),
    /outside of a server render/
  );
  // registerStyle() is a silent no-op outside a render by design (compiled
  // components call it unconditionally; RFC-0006's own doc comment notes
  // it should never crash a render over a missing context) — confirm that
  // stays true, not a throw.
  registerStyle('.should-not-throw{}');
});

console.log(`\nrequest isolation: all ${passed} tests passed`);
