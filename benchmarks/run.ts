/**
 * Benchmark runner — RFC-0014.
 * =================================================================
 * Runs all three MEASURED PROPERTIES (bundle size, hydration cost,
 * signal latency), compares against benchmarks/baseline.json, and
 * reports deltas. `npm run bench` (this script) is DELIBERATELY separate
 * from `npm test` — see this repo's package.json and RFC-0014's Open
 * Questions: wall-clock benchmarks (hydration-cost, signal-latency) are
 * noisier than the deterministic unit suite, so folding them into the
 * same gate as `npm test` would make that gate flaky for reasons
 * unrelated to correctness. bundle-size IS also wired into `npm test`
 * separately (tests/test-bundle-size.ts) as a hard, deterministic gate —
 * see that file's header comment — so this runner's bundle-size section
 * is reporting the SAME measurement `npm test` already gates on, not a
 * second, different check.
 *
 * REGRESSION TOLERANCE: a metric is flagged REGRESSED if it moved worse
 * by more than REGRESSION_TOLERANCE_PCT versus baseline.json. 5% is
 * chosen as "a few percent" (per this file's own brief) — small enough
 * to catch a real, deliberate size/latency increase, large enough that
 * ordinary run-to-run noise (especially hydration-cost's wall-clock
 * numbers, and to a lesser extent signal-latency's) doesn't false-flag a
 * non-regression as one. Bundle-size numbers are byte-exact/deterministic
 * so 5% is generous for them specifically, but one shared constant is
 * simpler than three separately-tuned tolerances and RFC-0014 doesn't
 * ask for per-metric tuning.
 *
 * "Worse" is metric-specific: for every size/latency number here, bigger
 * is worse EXCEPT `islandImportsRuntimeExternally` (a boolean gate, not
 * a percentage) and `hydrationRatio` (closer to 1.0 is better, but this
 * runner reports its trend rather than gating on it the same way, since
 * hydration-cost.ts's own TOLERANCE_RATIO already gates pass/fail).
 *
 * --update-baseline: overwrite benchmarks/baseline.json with the numbers
 * from THIS run — a deliberate, explicit action for when a regression is
 * an accepted tradeoff, never automatic.
 */
import fs from 'node:fs';
import { runBundleSize, type BundleSizeResult } from './bundle-size';
import { runHydrationCost, type HydrationCostResult } from './hydration-cost';
import { runSignalLatency, type SignalLatencyResults } from './signal-latency';
import { baselinePath, formatDelta, percentDelta, readBaseline, REGRESSION_TOLERANCE_PCT, type Baseline } from './shared';

/** Round wall-clock ms fields to 3 decimal places for a readable checked-in
 *  file — byte-count fields are already integers. Rounding here (not at
 *  the measurement site) keeps benchmarks/run.ts's in-memory numbers full
 *  precision for the regression-tolerance math above. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function writeBaseline(b: Baseline): void {
  const rounded: Baseline = {
    bundleSize: b.bundleSize,
    hydrationCost: {
      lowNMedianMs: round3(b.hydrationCost.lowNMedianMs),
      highNMedianMs: round3(b.hydrationCost.highNMedianMs),
      ratio: round3(b.hydrationCost.ratio),
    },
    signalLatency: {
      nSignalsOneEffectEachMedianMs: round3(b.signalLatency.nSignalsOneEffectEachMedianMs),
      oneSignalNEffectsMedianMs: round3(b.signalLatency.oneSignalNEffectsMedianMs),
    },
  };
  fs.writeFileSync(baselinePath, JSON.stringify(rounded, null, 2) + '\n', 'utf8');
}

interface Check {
  name: string;
  baseline: number | undefined;
  current: number;
  /** true if a LARGER current value is the regression direction. */
  biggerIsWorse: boolean;
}

function evaluateChecks(checks: Check[]): { regressed: string[]; lines: string[] } {
  const regressed: string[] = [];
  const lines: string[] = [];
  for (const c of checks) {
    if (c.baseline === undefined) {
      lines.push(`    ${c.name}: ${c.current} (no baseline entry)`);
      continue;
    }
    const pct = percentDelta(c.baseline, c.current);
    const worse = c.biggerIsWorse ? pct > REGRESSION_TOLERANCE_PCT : pct < -REGRESSION_TOLERANCE_PCT;
    lines.push(`    ${c.name}: ${formatDelta(c.baseline, c.current)}${worse ? '  <-- REGRESSED' : ''}`);
    if (worse) regressed.push(c.name);
  }
  return { regressed, lines };
}

async function main(): Promise<number> {
  const updateBaseline = process.argv.includes('--update-baseline');

  console.log('\n▲ najm bench — running all three RFC-0014 measured properties\n');

  console.log('[1/3] bundle size (pure Node, gating — see tests/test-bundle-size.ts)');
  const bundleSize: BundleSizeResult = runBundleSize();
  console.log(`    zero-island <script> tags: ${bundleSize.zeroIslandScriptTags} (hard gate: must be 0)`);
  console.log(`    island imports runtime externally: ${bundleSize.islandImportsRuntimeExternally} (hard gate: must be true)`);

  console.log('\n[2/3] hydration cost (Playwright, reported not gating)');
  const hydrationCost: HydrationCostResult = await runHydrationCost();

  console.log('\n[3/3] signal update latency (pure Node, reported not gating)');
  const signalLatency: SignalLatencyResults = runSignalLatency();

  const baseline = readBaseline();

  const checks: Check[] = [
    { name: 'bundle: runtime.js raw', baseline: baseline?.bundleSize.runtimeRaw, current: bundleSize.runtime.raw, biggerIsWorse: true },
    { name: 'bundle: runtime.js gzip', baseline: baseline?.bundleSize.runtimeGzip, current: bundleSize.runtime.gzip, biggerIsWorse: true },
    { name: 'bundle: island chunk raw', baseline: baseline?.bundleSize.islandChunkRaw, current: bundleSize.islandChunk.raw, biggerIsWorse: true },
    { name: 'bundle: island chunk gzip', baseline: baseline?.bundleSize.islandChunkGzip, current: bundleSize.islandChunk.gzip, biggerIsWorse: true },
    { name: 'hydration: low-N median', baseline: baseline?.hydrationCost.lowNMedianMs, current: hydrationCost.lowN.medianMs, biggerIsWorse: true },
    { name: 'hydration: high-N median', baseline: baseline?.hydrationCost.highNMedianMs, current: hydrationCost.highN.medianMs, biggerIsWorse: true },
    { name: 'signal: N-signals-one-effect-each median', baseline: baseline?.signalLatency.nSignalsOneEffectEachMedianMs, current: signalLatency.nSignalsOneEffectEach.medianMs, biggerIsWorse: true },
    { name: 'signal: one-signal-N-effects median', baseline: baseline?.signalLatency.oneSignalNEffectsMedianMs, current: signalLatency.oneSignalNEffects.medianMs, biggerIsWorse: true },
  ];

  console.log('\nresults vs. baseline.json:');
  if (!baseline) {
    console.log('    (no baseline.json yet — run with --update-baseline to create the initial snapshot)');
  }
  const { regressed, lines } = evaluateChecks(checks);
  for (const line of lines) console.log(line);
  console.log(`    hydration: high/low ratio ${hydrationCost.ratio.toFixed(2)}x (own tolerance: see hydration-cost.ts, gate ${hydrationCost.withinTolerance ? 'PASS' : 'FAIL'})`);

  const newBaseline: Baseline = {
    bundleSize: {
      runtimeRaw: bundleSize.runtime.raw,
      runtimeGzip: bundleSize.runtime.gzip,
      islandChunkRaw: bundleSize.islandChunk.raw,
      islandChunkGzip: bundleSize.islandChunk.gzip,
    },
    hydrationCost: {
      lowNMedianMs: hydrationCost.lowN.medianMs,
      highNMedianMs: hydrationCost.highN.medianMs,
      ratio: hydrationCost.ratio,
    },
    signalLatency: {
      nSignalsOneEffectEachMedianMs: signalLatency.nSignalsOneEffectEach.medianMs,
      oneSignalNEffectsMedianMs: signalLatency.oneSignalNEffects.medianMs,
    },
  };

  if (updateBaseline) {
    writeBaseline(newBaseline);
    console.log(`\n  ✓ baseline.json updated with this run's numbers\n`);
    return 0;
  }

  let failed = false;
  if (bundleSize.zeroIslandScriptTags !== 0 || !bundleSize.islandImportsRuntimeExternally) {
    failed = true; // already thrown inside runBundleSize() in practice; defensive.
  }
  if (!hydrationCost.withinTolerance) {
    console.log(`\n  i hydration-cost ratio exceeded its own tolerance — reported, not gating this run's exit code (see RFC-0014 Open Questions).`);
  }
  if (regressed.length > 0) {
    console.log(`\n  i ${regressed.length} metric(s) regressed >${REGRESSION_TOLERANCE_PCT}% vs. baseline: ${regressed.join(', ')}`);
    console.log(`    bundle-size regressions fail \`npm test\` via tests/test-bundle-size.ts; hydration/signal regressions are reported only.`);
  } else if (baseline) {
    console.log(`\n  ✓ no metric regressed beyond ${REGRESSION_TOLERANCE_PCT}% vs. baseline.json`);
  }

  console.log('');
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
