import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.scripts['test:packages'], 'tsx scripts/test-packages.ts');

const source = fs.readFileSync('scripts/test-packages.ts', 'utf8');
const serveSource = fs.readFileSync('server/serve.ts', 'utf8');
for (const required of ["['pack'", "['install'", '.tmp/package-smoke', 'finally', 'import.meta.resolve']) {
  assert.ok(source.includes(required), `package smoke script must include ${required}`);
}
for (const path of ['/core', '/vite', '/plugin-api', '/middleware', '/dev', '/build', '/serve', '/package.json']) {
  assert.ok(source.includes(path), `package smoke script must cover ${path}`);
}
for (const required of ["'src', 'pages'", "['run', 'build']", 'vite.config.ts', 'dist', 'manifest.json']) {
  assert.ok(source.includes(required), `package smoke script must execute an adopter build and include ${required}`);
}
assert.match(serveSource, /const root = process\.cwd\(\)/, 'published preview must serve the adopter working directory');

console.log('package smoke contract: all assertions passed');
