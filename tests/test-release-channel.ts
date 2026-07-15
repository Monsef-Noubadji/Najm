import assert from 'node:assert/strict';
import fs from 'node:fs';
import { releaseTag } from '../scripts/release-tag';

assert.equal(releaseTag('1.0.0-rc.0'), 'next');
assert.equal(releaseTag('2.0.0-rc.3'), 'next');
assert.equal(releaseTag('1.0.0'), 'latest');
assert.throws(() => releaseTag('1.0.0-beta.1'), /unsupported prerelease/);
assert.throws(() => releaseTag('not-semver'), /invalid version/);

const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const releaseScript = fs.readFileSync('scripts/release-tag.ts', 'utf8');
for (const command of ['npm run test:packages', 'npm run bench', 'npm run docs:check', 'npm run release:ci']) {
  assert.ok(workflow.includes(command), `release workflow must run ${command}`);
}
assert.ok(
  workflow.indexOf('npm run build:packages') < workflow.indexOf('npm run typecheck'),
  'clean CI must build workspace declarations before typechecking adopter-style package imports',
);
assert.ok(
  workflow.includes('npx playwright install --with-deps chromium') &&
  workflow.indexOf('npx playwright install --with-deps chromium') < workflow.indexOf('npm run bench'),
  'clean CI must install Chromium before browser benchmarks',
);
assert.ok(!workflow.includes('--tag beta'), 'release workflow must not hard-code beta');
assert.ok(
  !releaseScript.includes("['run', 'release', '--', '--tag', 'next']"),
  'Changesets prerelease mode must publish without a custom tag',
);
assert.ok(
  releaseScript.includes("pre.tag = 'next'") && releaseScript.includes('writeFileSync(prePath, originalPre'),
  'RC publication must atomically publish under next and restore prerelease metadata',
);

console.log('release channel: all assertions passed');
