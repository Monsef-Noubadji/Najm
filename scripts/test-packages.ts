import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const smokeRoot = path.join(root, '.tmp/package-smoke');
const packsDir = path.join(smokeRoot, 'packs');
const consumerDir = path.join(smokeRoot, 'consumer');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'npm_execpath is required; run this harness through npm run test:packages');

function run(args: string[], cwd = root): string {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

try {
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(packsDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  run(['run', 'build:packages']);
  const packed = JSON.parse(run(['pack', '--json', '--workspaces', '--pack-destination', packsDir])) as Array<{ filename: string }>;
  assert.equal(packed.length, 4, 'npm pack must produce four workspace tarballs');

  writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({ name: 'najm-package-smoke', private: true, type: 'module' }, null, 2));
  const tarballs = packed.map(({ filename }) => path.join(packsDir, filename));
  run(['install', '--ignore-scripts', 'vite@^6', ...tarballs], consumerDir);

  const manifests = ['najm', 'najm-compiler', 'najm-router', 'najm-server'].map((dir) =>
    JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8')),
  );
  for (const manifest of manifests) assert.equal(manifest.bin, undefined, `${manifest.name} must not advertise a CLI`);

  const verifier = `
    await import('@monsef-nbj/najm');
    await import('@monsef-nbj/najm/core');
    await import('@monsef-nbj/najm-compiler');
    await import('@monsef-nbj/najm-compiler/vite');
    await import('@monsef-nbj/najm-compiler/plugin-api');
    await import('@monsef-nbj/najm-router');
    await import('@monsef-nbj/najm-router/middleware');
    for (const specifier of [
      '@monsef-nbj/najm/package.json',
      '@monsef-nbj/najm-compiler/package.json',
      '@monsef-nbj/najm-router/package.json',
      '@monsef-nbj/najm-server/package.json',
      '@monsef-nbj/najm-server/dev',
      '@monsef-nbj/najm-server/build',
      '@monsef-nbj/najm-server/serve'
    ]) import.meta.resolve(specifier);
    console.log('registry-shaped consumer imports verified');
  `;
  const verifierPath = path.join(consumerDir, 'verify.mjs');
  writeFileSync(verifierPath, verifier);
  const verification = spawnSync(process.execPath, [verifierPath], { cwd: consumerDir, encoding: 'utf8' });
  assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);
  process.stdout.write(verification.stdout);
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
