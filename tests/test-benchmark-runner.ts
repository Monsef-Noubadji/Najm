import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('benchmarks/run.ts', 'utf8');
const signalRun = source.indexOf('const signalLatency: SignalLatencyResults = runSignalLatency()');
const bundleRun = source.indexOf('const bundleSize: BundleSizeResult = runBundleSize()');
const hydrationRun = source.indexOf('const hydrationCost: HydrationCostResult = await runHydrationCost()');
assert.ok(signalRun >= 0 && bundleRun >= 0 && hydrationRun >= 0, 'runner must execute all benchmarks');
assert.ok(signalRun < bundleRun, 'sub-millisecond signal latency must run before fixture build work');
assert.ok(signalRun < hydrationRun, 'sub-millisecond signal latency must run before Playwright');

console.log('benchmark runner: uncontaminated measurement order verified');
