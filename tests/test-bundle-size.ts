/**
 * Bundle-size test suite — RFC-0014's ONE hard CI gate among its three
 * measured properties.
 *
 * Per RFC-0014's Open Questions: bundle-size checks are deterministic
 * and byte-exact (no wall-clock measurement anywhere in
 * benchmarks/bundle-size.ts), so — unlike hydration-cost and
 * signal-latency, which stay in the separate, non-gating `npm run bench`
 * — this property is split into a real test in the `npm test` chain,
 * gating on BOTH the two structural regression gates (zero-JS,
 * external-runtime-import) AND a real regression check against
 * benchmarks/baseline.json (self-relative, per RFC-0014's design — not a
 * hand-picked static budget). Imports benchmarks/bundle-size.ts's
 * runBundleSize() directly rather than reimplementing the measurement:
 * one source of truth for what "bundle size" means, used by both
 * `npm test` (this file, hard gate) and `npm run bench`
 * (benchmarks/run.ts, same baseline comparison, plus the two
 * non-gating wall-clock properties).
 */
import assert from 'node:assert/strict';
import { runBundleSize } from '../benchmarks/bundle-size';
import { isRegression, readBaseline, REGRESSION_TOLERANCE_PCT } from '../benchmarks/shared';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// One real build of benchmarks/fixtures/, shared by every assertion below
// (runBundleSize() builds + measures + enforces the two hard gates
// itself — see its own throws for the zero-JS and external-import
// checks; a thrown error here fails this suite the same as an
// assertion would).
const result = runBundleSize();

test('zero-island page ships exactly 0 <script> tags', () => {
  assert.equal(result.zeroIslandScriptTags, 0);
});

test('the with-island page\'s island chunk imports the shared runtime externally, not a bundled duplicate', () => {
  assert.equal(result.islandImportsRuntimeExternally, true);
});

test('dist/client/runtime.js exists and has a positive, sane byte size', () => {
  assert.ok(result.runtime.raw > 0);
  assert.ok(result.runtime.gzip > 0);
  assert.ok(result.runtime.gzip < result.runtime.raw, 'gzip size should be smaller than raw size');
});

test('the island chunk exists and has a positive, sane byte size', () => {
  assert.ok(result.islandChunk.raw > 0);
  assert.ok(result.islandChunk.gzip > 0);
  assert.ok(result.islandChunk.gzip < result.islandChunk.raw, 'gzip size should be smaller than raw size');
});

// Self-relative regression gate — benchmarks/baseline.json, not a
// hand-picked static budget (RFC-0014's explicit design choice; see its
// "Alternatives considered"). Skipped gracefully if baseline.json is
// ever missing (should not happen in this repo — it's checked in — but
// this suite shouldn't crash on a fresh checkout mid-bootstrap either).
const baseline = readBaseline();
if (baseline) {
  test(`runtime.js raw size has not regressed >${REGRESSION_TOLERANCE_PCT}% vs. baseline.json`, () => {
    assert.ok(
      !isRegression(baseline.bundleSize.runtimeRaw, result.runtime.raw),
      `runtime.js raw: ${baseline.bundleSize.runtimeRaw} -> ${result.runtime.raw} bytes`
    );
  });
  test(`runtime.js gzip size has not regressed >${REGRESSION_TOLERANCE_PCT}% vs. baseline.json`, () => {
    assert.ok(
      !isRegression(baseline.bundleSize.runtimeGzip, result.runtime.gzip),
      `runtime.js gzip: ${baseline.bundleSize.runtimeGzip} -> ${result.runtime.gzip} bytes`
    );
  });
  test(`island chunk raw size has not regressed >${REGRESSION_TOLERANCE_PCT}% vs. baseline.json`, () => {
    assert.ok(
      !isRegression(baseline.bundleSize.islandChunkRaw, result.islandChunk.raw),
      `island chunk raw: ${baseline.bundleSize.islandChunkRaw} -> ${result.islandChunk.raw} bytes — ` +
        `if this is an intentional tradeoff, run \`npm run bench -- --update-baseline\``
    );
  });
  test(`island chunk gzip size has not regressed >${REGRESSION_TOLERANCE_PCT}% vs. baseline.json`, () => {
    assert.ok(
      !isRegression(baseline.bundleSize.islandChunkGzip, result.islandChunk.gzip),
      `island chunk gzip: ${baseline.bundleSize.islandChunkGzip} -> ${result.islandChunk.gzip} bytes — ` +
        `if this is an intentional tradeoff, run \`npm run bench -- --update-baseline\``
    );
  });
} else {
  console.log('  i benchmarks/baseline.json not found — skipping regression checks (structural checks above still ran)');
}

console.log(`\nbundle-size: all ${passed} tests passed`);
