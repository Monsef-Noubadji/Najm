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

const check = fs.readFileSync('.github/workflows/docs-check.yml', 'utf8');
assert.match(check, /pull_request:/);
assert.match(check, /contents:\s*read/);
assert.match(check, /npm ci/);
assert.match(check, /npm run docs:check/);

const pages = fs.readFileSync('.github/workflows/docs-pages.yml', 'utf8');
assert.match(pages, /configure-pages@v5/);
assert.match(pages, /upload-pages-artifact@v3/);
assert.match(pages, /deploy-pages@v4/);
assert.match(pages, /pages:\s*write/);
assert.match(pages, /id-token:\s*write/);
assert.match(pages, /concurrency:/);

console.log('docs config: all assertions passed');
