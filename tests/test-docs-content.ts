import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = [
  'docs/guide/introduction.md', 'docs/guide/getting-started.md',
  'docs/guide/project-structure.md', 'docs/guide/production.md',
  'docs/guide/release-status.md', 'docs/guide/components.md',
  'docs/guide/routing-and-ssr.md', 'docs/learn/islands-and-hydration.md',
  'docs/learn/store-and-context.md', 'docs/learn/error-boundaries.md',
];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  assert.equal(content.match(/^# /gm)?.length, 1, `${file} must have one H1`);
  assert.doesNotMatch(content, /0\.3\.0-dev|not yet published|git clone <this-repo>|from ['"]najm\/core['"]/i, `${file} contains stale guidance`);
}
const start = readFileSync('docs/guide/getting-started.md', 'utf8');
assert.match(start, /npm install @monsef-nbj\/najm@next/);
assert.match(start, /@monsef-nbj\/najm\/core/);
assert.match(start, /<template>[\s\S]*Najm is rendering HTML[\s\S]*<\/template>/);
console.log('docs content: all assertions passed');
