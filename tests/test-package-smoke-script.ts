import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.scripts['test:packages'], 'tsx scripts/test-packages.ts');

const repoRoot = process.cwd();
const runtimePackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'najm', 'package.json'), 'utf8'));
assert.equal(runtimePackage.bin.najm, './dist/cli.js');
assert.equal(runtimePackage.bin['create-najm-app'], './dist/create-app.js');
assert.ok(runtimePackage.dependencies['@monsef-nbj/najm-compiler']);
assert.ok(runtimePackage.dependencies['@monsef-nbj/najm-router']);
assert.ok(runtimePackage.dependencies['@monsef-nbj/najm-server']);
assert.ok(runtimePackage.peerDependencies.vite);
assert.ok(fs.existsSync(path.join(repoRoot, 'packages', 'najm', 'dist', 'cli.js')));
assert.ok(fs.existsSync(path.join(repoRoot, 'packages', 'najm', 'dist', 'create-app.js')));

const source = fs.readFileSync('scripts/test-packages.ts', 'utf8');
const serveSource = fs.readFileSync('server/serve.ts', 'utf8');
const buildSource = fs.readFileSync('server/build.ts', 'utf8');
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
assert.match(buildSource, /existsSync\(publishedRuntime\)/, 'source builds must tolerate workspace packages before dist exists');

console.log('package smoke contract: all assertions passed');
