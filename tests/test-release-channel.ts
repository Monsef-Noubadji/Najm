import assert from 'node:assert/strict';
import fs from 'node:fs';
import { releaseTag } from '../scripts/release-tag';

assert.equal(releaseTag('1.0.0-rc.0'), 'next');
assert.equal(releaseTag('2.0.0-rc.3'), 'next');
assert.equal(releaseTag('1.0.0'), 'latest');
assert.throws(() => releaseTag('1.0.0-beta.1'), /unsupported prerelease/);
assert.throws(() => releaseTag('not-semver'), /invalid version/);

const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
for (const command of ['npm run test:packages', 'npm run bench', 'npm run docs:check', 'npm run release:ci']) {
  assert.ok(workflow.includes(command), `release workflow must run ${command}`);
}
assert.ok(!workflow.includes('--tag beta'), 'release workflow must not hard-code beta');

console.log('release channel: all assertions passed');
