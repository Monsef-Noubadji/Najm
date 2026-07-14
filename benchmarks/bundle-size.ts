/**
 * Bundle size — RFC-0014, measured property 1 of 3.
 * =================================================================
 * Pure Node, no browser: builds benchmarks/fixtures/ via the real
 * server/build.ts pipeline (see shared.ts's buildFixtures()) and
 * measures the real dist/ output it produces.
 *
 *   - zero-island page: 0 bytes JS is a HARD regression gate — this
 *     function throws if a <script> tag appears anywhere in the built
 *     HTML, independent of baseline comparison (see runBundleSize()).
 *   - dist/client/runtime.js: raw + gzip size (shared-runtime cost paid
 *     once per island-bearing page).
 *   - the with-island page's island chunk: raw + gzip size, plus a check
 *     that its only import of the runtime is the EXTERNAL reference
 *     "/client/runtime.js" (not a bundled duplicate copy) — the exact
 *     class of bug server/build.ts's implementation found and fixed live
 *     (see server/build.ts Step 3's comment), automated here as a
 *     permanent regression check.
 *
 * Deterministic and byte-exact — no wall-clock measurement anywhere in
 * this file — which is why this is the one property split into a real
 * gating test (tests/test-bundle-size.ts imports runBundleSize() below).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures, fixturesDist, measureFile, readFixturesManifest, type SizeMeasurement } from './shared';

export interface BundleSizeResult {
  zeroIslandScriptTags: number;
  runtime: SizeMeasurement;
  islandChunk: SizeMeasurement;
  islandChunkFile: string;
  /** true iff the island chunk's only import of the runtime is the
   *  external "/client/runtime.js" reference, not a bundled duplicate. */
  islandImportsRuntimeExternally: boolean;
}

/** Runs the real fixture build. Call once per process; both bundle-size.ts's
 *  standalone run and hydration-cost.ts's run share the fixtures/dist/ this
 *  produces, so the runner (benchmarks/run.ts) builds once, not twice. */
export { buildFixtures };

export function measureBundleSize(): BundleSizeResult {
  const manifest = readFixturesManifest();

  // --- zero-island page: hard gate, checked independent of baseline ---
  const zeroIslandRoute = manifest.routes.find((r) => r.pathname === '/zero-island');
  if (!zeroIslandRoute || zeroIslandRoute.type !== 'static' || !zeroIslandRoute.htmlFile) {
    throw new Error('[bundle-size] /zero-island route missing or not static in fixtures manifest');
  }
  const zeroIslandHtml = fs.readFileSync(path.join(fixturesDist, zeroIslandRoute.htmlFile), 'utf8');
  const zeroIslandScriptTags = (zeroIslandHtml.match(/<script/g) ?? []).length;

  // --- shared runtime ---
  const runtimeFile = path.join(fixturesDist, 'client', 'runtime.js');
  const runtime = measureFile(runtimeFile);

  // --- island chunk (the with-island page's Widget island) ---
  const islandSrcs = Object.keys(manifest.islands);
  const widgetSrc = islandSrcs.find((s) => s.endsWith('Widget.najm'));
  if (!widgetSrc) {
    throw new Error('[bundle-size] Widget island not found in fixtures manifest.islands');
  }
  const islandChunkUrl = manifest.islands[widgetSrc]; // e.g. "/client/assets/Widget.<hash>.js"
  const islandChunkFile = path.join(fixturesDist, islandChunkUrl.replace(/^\/client\//, 'client/'));
  const islandChunk = measureFile(islandChunkFile);

  const islandChunkSource = fs.readFileSync(islandChunkFile, 'utf8');
  const importSpecifiers = [...islandChunkSource.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const runtimeImports = importSpecifiers.filter((s) => s.includes('runtime'));
  const islandImportsRuntimeExternally =
    runtimeImports.length > 0 && runtimeImports.every((s) => s === '/client/runtime.js');

  return {
    zeroIslandScriptTags,
    runtime,
    islandChunk,
    islandChunkFile: path.relative(fixturesDist, islandChunkFile).split(path.sep).join('/'),
    islandImportsRuntimeExternally,
  };
}

/** Full run: build the fixtures, measure, and enforce the hard zero-JS gate. */
export function runBundleSize(): BundleSizeResult {
  buildFixtures();
  const result = measureBundleSize();
  if (result.zeroIslandScriptTags !== 0) {
    throw new Error(
      `[bundle-size] REGRESSION (hard gate): /zero-island shipped ${result.zeroIslandScriptTags} <script> tag(s), expected 0`
    );
  }
  if (!result.islandImportsRuntimeExternally) {
    throw new Error(
      `[bundle-size] REGRESSION (hard gate): island chunk ${result.islandChunkFile} does not import the runtime externally ` +
        `(expected exactly "/client/runtime.js") — it may be bundling a private duplicate copy`
    );
  }
  return result;
}

// Standalone invocation: `tsx benchmarks/bundle-size.ts`.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runBundleSize();
  console.log('\nbundle size:');
  console.log(`  zero-island <script> tags: ${result.zeroIslandScriptTags}`);
  console.log(`  runtime.js:   ${result.runtime.raw} bytes raw / ${result.runtime.gzip} bytes gzip`);
  console.log(`  island chunk: ${result.islandChunk.raw} bytes raw / ${result.islandChunk.gzip} bytes gzip (${result.islandChunkFile})`);
  console.log(`  island imports runtime externally: ${result.islandImportsRuntimeExternally}`);
}
