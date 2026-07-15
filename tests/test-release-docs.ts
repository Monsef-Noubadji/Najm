import assert from 'node:assert/strict';
import fs from 'node:fs';

const activeFiles = [
  'README.md', 'SECURITY.md', 'packages/README.md', 'docs/index.md',
  'docs/guide/introduction.md', 'docs/guide/getting-started.md',
  'docs/guide/release-status.md', 'docs/contributing/releases.md',
  'docs/contributing/1.0-release.md', 'docs/.vitepress/config.mts',
];
const active = activeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
assert.match(active, /1\.0\.0-rc\.1/);
assert.match(active, /@next/);
assert.match(active, /CLI[\s\S]{0,120}(deferred|repository-only)/i);
assert.match(active, /\/guide\/release-status/);
assert.doesNotMatch(active, /@beta|0\.3\.0-beta|beta software/i);

console.log('release docs: RC guidance and CLI deferral verified');
