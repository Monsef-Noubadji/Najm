import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.scripts['test:packages'], 'tsx scripts/test-packages.ts');

const source = fs.readFileSync('scripts/test-packages.ts', 'utf8');
for (const required of ["['pack'", "['install'", '.tmp/package-smoke', 'finally', 'import.meta.resolve']) {
  assert.ok(source.includes(required), `package smoke script must include ${required}`);
}
for (const path of ['/core', '/vite', '/plugin-api', '/middleware', '/dev', '/build', '/serve', '/package.json']) {
  assert.ok(source.includes(path), `package smoke script must cover ${path}`);
}

console.log('package smoke contract: all assertions passed');
