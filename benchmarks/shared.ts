/**
 * Shared plumbing for benchmarks/ — RFC-0014.
 * =================================================================
 * Small helpers common to more than one of the three MEASURED
 * PROPERTIES (bundle size, hydration cost, signal latency). Each
 * property's own script (bundle-size.ts, hydration-cost.ts,
 * signal-latency.ts) stays independently readable and independently
 * runnable; this module holds only what would otherwise be duplicated.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixturesRoot = path.join(repoRoot, 'benchmarks', 'fixtures');
export const fixturesDist = path.join(fixturesRoot, 'dist');
export const baselinePath = path.join(repoRoot, 'benchmarks', 'baseline.json');

/**
 * Shared regression tolerance ("a few percent", per RFC-0014's design):
 * a metric that grew worse by more than this, versus baseline.json, is a
 * REGRESSION. One constant used by BOTH tests/test-bundle-size.ts (the
 * hard `npm test` gate on bundle-size specifically) and benchmarks/run.ts
 * (the reported, non-gating comparison for all three properties) so the
 * two never quietly disagree on what "worse" means for the same numbers.
 */
export const REGRESSION_TOLERANCE_PCT = 5;

/** Raw + gzip byte size of a file. */
export interface SizeMeasurement {
  raw: number;
  gzip: number;
}

export function measureFile(file: string): SizeMeasurement {
  const buf = fs.readFileSync(file);
  return { raw: buf.length, gzip: zlib.gzipSync(buf).length };
}

/**
 * Build benchmarks/fixtures/ via the real server/build.ts pipeline,
 * targeting it (not this repo's own src/pages/) via NAJM_APP_ROOT — see
 * server/build.ts's header comment for why that env var exists. Runs the
 * SAME build every one of RFC-0014's three properties could in principle
 * need; only bundle-size.ts and hydration-cost.ts actually call this
 * (signal-latency.ts exercises runtime/signals.ts + runtime/scheduler.ts
 * directly, no compiler/build involved at all, per the RFC).
 */
export function buildFixtures(): void {
  execFileSync('npx tsx server/build.ts', {
    cwd: repoRoot,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NAJM_APP_ROOT: fixturesRoot },
  });
}

export interface Manifest {
  routes: Array<{ type: 'static' | 'dynamic'; pathname: string; htmlFile?: string }>;
  islands: Record<string, string>;
}

export function readFixturesManifest(): Manifest {
  return JSON.parse(fs.readFileSync(path.join(fixturesDist, 'manifest.json'), 'utf8'));
}

/** Percent difference of `current` from `baseline` (positive = grew). */
export function percentDelta(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : Infinity;
  return ((current - baseline) / baseline) * 100;
}

export function formatDelta(baseline: number, current: number): string {
  const pct = percentDelta(baseline, current);
  if (!isFinite(pct)) return `${baseline} -> ${current} (new)`;
  const sign = pct >= 0 ? '+' : '';
  return `${baseline} -> ${current} (${sign}${pct.toFixed(1)}%)`;
}

/** True iff `current` is worse than `baseline` by more than
 *  REGRESSION_TOLERANCE_PCT, for a metric where BIGGER is worse (every
 *  metric in benchmarks/baseline.json today — byte sizes and wall-clock
 *  durations both regress by growing). */
export function isRegression(baseline: number, current: number): boolean {
  return percentDelta(baseline, current) > REGRESSION_TOLERANCE_PCT;
}

export interface BundleSizeBaseline {
  runtimeRaw: number;
  runtimeGzip: number;
  islandChunkRaw: number;
  islandChunkGzip: number;
}

export interface Baseline {
  bundleSize: BundleSizeBaseline;
  hydrationCost: { lowNMedianMs: number; highNMedianMs: number; ratio: number };
  signalLatency: { nSignalsOneEffectEachMedianMs: number; oneSignalNEffectsMedianMs: number };
}

/** Reads benchmarks/baseline.json, or null if it hasn't been created yet
 *  (e.g. before the first `--update-baseline` run in a fresh checkout —
 *  should not happen in this repo since baseline.json is checked in, but
 *  callers should not crash if it's ever missing). */
export function readBaseline(): Baseline | null {
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}
