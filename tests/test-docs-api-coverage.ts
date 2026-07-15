import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packages = ['najm', 'najm-compiler', 'najm-router', 'najm-server'];
const packageDocs = readFileSync('docs/reference/packages.md', 'utf8');
for (const name of packages) {
  const pkg = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
  for (const key of Object.keys(pkg.exports)) {
    const suffix = key === '.' ? '' : key.slice(1);
    assert.match(packageDocs, new RegExp(`${pkg.name.replace('/', '\\/')}${suffix.replace('/', '\\/')}`));
  }
}
const runtimeDocs = readFileSync('docs/reference/runtime.md', 'utf8');
for (const name of ['signal', 'computed', 'effect', 'batch', 'createRoot', 'defineStore', 'createContext', 'onMounted', 'mountComponent', 'escapeHtml', 'bindText', 'claim', 'renderToHtml', 'renderIsland', 'hydrateIslands', 'withErrorBoundary']) {
  assert.match(runtimeDocs, new RegExp(`\\b${name}\\b`), `runtime docs missing ${name}`);
}
console.log('docs API coverage: all assertions passed');
