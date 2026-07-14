/**
 * Signal update latency — RFC-0014, measured property 3 of 3.
 * =================================================================
 * Pure Node, no browser, no compiler/build involved at all — exercises
 * runtime/signals.ts + runtime/scheduler.ts directly, per the RFC's
 * exact spec:
 *
 *   - "N signals each read by exactly one effect": write to all N
 *     signals, time until every one of the N direct-subscriber effects
 *     has finished its run.
 *   - "one signal read by N effects": write to the one signal, time
 *     until all N direct-subscriber effects have finished.
 *
 * Both cases measure wall-clock time from `signal.value = x` to every
 * DIRECT-subscriber effect finishing — writes happen outside batch(), so
 * scheduler.ts's 'sync' priority runs each triggered effect immediately
 * (see scheduler.ts's module doc), meaning the write call itself doesn't
 * return until all direct subscribers have run. `performance.now()`
 * deltas around the write are therefore a real, direct measurement of
 * this cost, not an approximation.
 */
import { signal, effect } from '../runtime/signals';

export interface LatencyResult {
  /** Median wall-clock time (ms) for ALL N writes/effect-runs in one trial. */
  medianMs: number;
  /** Median per-signal/per-effect time (ms), i.e. medianMs / n. */
  medianPerUnitMs: number;
  n: number;
  trials: number;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** N signals, each read by exactly its own one effect. */
export function benchNSignalsOneEffectEach(n: number, trials: number): LatencyResult {
  const sigs = Array.from({ length: n }, () => signal(0));
  for (const s of sigs) {
    effect(() => {
      void s.value; // subscribe
    });
  }

  const samples: number[] = [];
  for (let t = 0; t < trials; t++) {
    const start = performance.now();
    for (const s of sigs) s.value = s.peek() + 1;
    samples.push(performance.now() - start);
  }

  const medianMs = median(samples);
  return { medianMs, medianPerUnitMs: medianMs / n, n, trials };
}

/** One signal, read by N effects. */
export function benchOneSignalNEffects(n: number, trials: number): LatencyResult {
  const s = signal(0);
  for (let i = 0; i < n; i++) {
    effect(() => {
      void s.value; // subscribe
    });
  }

  const samples: number[] = [];
  for (let t = 0; t < trials; t++) {
    const start = performance.now();
    s.value = s.peek() + 1;
    samples.push(performance.now() - start);
  }

  const medianMs = median(samples);
  return { medianMs, medianPerUnitMs: medianMs / n, n, trials };
}

export interface SignalLatencyResults {
  nSignalsOneEffectEach: LatencyResult;
  oneSignalNEffects: LatencyResult;
}

/** N and trial count: N=1000 is large enough that JIT/timer noise is a
 *  small fraction of the total, small enough to run in well under a
 *  second; 50 trials gives a stable median without a slow benchmark run. */
const N = 1000;
const TRIALS = 50;

export function runSignalLatency(): SignalLatencyResults {
  return {
    nSignalsOneEffectEach: benchNSignalsOneEffectEach(N, TRIALS),
    oneSignalNEffects: benchOneSignalNEffects(N, TRIALS),
  };
}

// Standalone invocation: `tsx benchmarks/signal-latency.ts`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const results = runSignalLatency();
  console.log('\nsignal update latency:');
  console.log(
    `  N=${N} signals, each read by exactly one effect: ${results.nSignalsOneEffectEach.medianMs.toFixed(3)}ms total / ` +
      `${(results.nSignalsOneEffectEach.medianPerUnitMs * 1000).toFixed(2)}us per signal (median of ${TRIALS} trials)`
  );
  console.log(
    `  one signal, read by N=${N} effects: ${results.oneSignalNEffects.medianMs.toFixed(3)}ms total / ` +
      `${(results.oneSignalNEffects.medianPerUnitMs * 1000).toFixed(2)}us per effect (median of ${TRIALS} trials)`
  );
}
