import assert from 'node:assert/strict';
import fs from 'node:fs';

type Manifest = {
  packages: Record<string, string[]>;
  runtime: { tier1: string[]; tier2: string[] };
  internalOnly: string[];
};

const manifest = JSON.parse(fs.readFileSync('api-stability.json', 'utf8')) as Manifest;
const packageDirs = ['najm', 'najm-compiler', 'najm-router', 'najm-server'];

for (const dir of packageDirs) {
  const pkg = JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, 'utf8'));
  assert.deepEqual(
    [...manifest.packages[pkg.name]].sort(),
    Object.keys(pkg.exports).sort(),
    `${pkg.name} export paths must match the stability manifest`,
  );
}

const source = fs.readFileSync('runtime/index.ts', 'utf8');
const exported = new Set<string>();
for (const block of source.matchAll(/export(?:\s+type)?\s*\{([\s\S]*?)\}\s*from/g)) {
  for (const item of block[1].split(',')) {
    const name = item.trim().split(/\s+as\s+/).at(-1);
    if (name) exported.add(name);
  }
}

const classified = [...manifest.runtime.tier1, ...manifest.runtime.tier2];
assert.equal(new Set(classified).size, classified.length, 'public symbols must have one tier');
assert.deepEqual([...exported].sort(), [...classified].sort(), 'every runtime export must be classified');
for (const name of manifest.internalOnly) {
  assert.ok(!exported.has(name), `${name} must not leak through runtime/index.ts`);
}

console.log(`api stability: ${exported.size} runtime exports and four package maps verified`);
