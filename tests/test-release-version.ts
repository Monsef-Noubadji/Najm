import assert from 'node:assert/strict';
import fs from 'node:fs';

const expected = '1.1.0-rc.1';
for (const dir of ['najm', 'najm-compiler', 'najm-router', 'najm-server']) {
  const pkg = JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, 'utf8'));
  assert.equal(pkg.version, expected, `${pkg.name} must use the coordinated CLI hardening RC version`);
  const changelog = fs.readFileSync(`packages/${dir}/CHANGELOG.md`, 'utf8');
  assert.match(changelog, new RegExp(`^# .+\\r?\\n\\r?\\n## ${expected.replaceAll('.', '\\.')}`, 'm'), `${pkg.name} changelog must lead with 1.1.0-rc.1`);
}

assert.equal(fs.existsSync('.changeset/pre.json'), false, 'manual RC hardening state must be outside Changesets prerelease mode');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const dir of ['najm', 'najm-compiler', 'najm-router', 'najm-server']) {
  assert.equal(lock.packages[`packages/${dir}`].version, expected, `lockfile must match packages/${dir}`);
}

console.log('release version: coordinated 1.1.0-rc.1 state verified');
