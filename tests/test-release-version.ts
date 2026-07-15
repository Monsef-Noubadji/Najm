import assert from 'node:assert/strict';
import fs from 'node:fs';

const expected = '1.0.0-rc.0';
for (const dir of ['najm', 'najm-compiler', 'najm-router', 'najm-server']) {
  const pkg = JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, 'utf8'));
  assert.equal(pkg.version, expected, `${pkg.name} must use the coordinated RC version`);
  const changelog = fs.readFileSync(`packages/${dir}/CHANGELOG.md`, 'utf8');
  assert.match(changelog, /^# .+\r?\n\r?\n## 1\.0\.0-rc\.0/m, `${pkg.name} changelog must lead with the RC`);
}

const pre = JSON.parse(fs.readFileSync('.changeset/pre.json', 'utf8'));
assert.equal(pre.mode, 'pre');
assert.equal(pre.tag, 'rc');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const dir of ['najm', 'najm-compiler', 'najm-router', 'najm-server']) {
  assert.equal(lock.packages[`packages/${dir}`].version, expected, `lockfile must match packages/${dir}`);
}

console.log('release version: coordinated 1.0.0-rc.0 state verified');
