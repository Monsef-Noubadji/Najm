import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const configPath = 'docs/.vitepress/config.mts';

assert.equal(pkg.scripts['docs:dev'], 'vitepress dev docs');
assert.equal(pkg.scripts['docs:build'], 'vitepress build docs');
assert.equal(pkg.scripts['docs:preview'], 'vitepress preview docs');
assert.equal(pkg.scripts['docs:check'], 'npm run docs:build');
assert.ok(fs.existsSync(configPath), 'expected VitePress config');

const config = fs.readFileSync(configPath, 'utf8');
assert.match(config, /base:\s*['"]\/Najm\/['"]/);
assert.match(config, /provider:\s*['"]local['"]/);
assert.match(config, /Monsef-Noubadji\/Najm/);

console.log('docs config: all assertions passed');
