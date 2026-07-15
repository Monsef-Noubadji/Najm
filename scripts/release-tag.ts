import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type ReleaseTag = 'next' | 'latest';

export function releaseTag(version: string): ReleaseTag {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid version: ${version}`);
  }
  if (!version.includes('-')) return 'latest';
  if (/^\d+\.\d+\.\d+-rc\.\d+$/.test(version)) return 'next';
  throw new Error(`unsupported prerelease version: ${version}`);
}

function publish(): void {
  const dirs = ['najm', 'najm-compiler', 'najm-router', 'najm-server'];
  const packages = dirs.map((dir) => JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8')) as {
    name: string;
    version: string;
  });
  const versions = packages.map((pkg) => pkg.version);
  assert.equal(new Set(versions).size, 1, `fixed package group has mixed versions: ${versions.join(', ')}`);
  const tag = releaseTag(versions[0]);
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'npm_execpath is required; run through npm run release:ci');

  const prePath = '.changeset/pre.json';
  const originalPre = tag === 'next' ? readFileSync(prePath, 'utf8') : undefined;
  if (originalPre) {
    const pre = JSON.parse(originalPre);
    pre.tag = 'next';
    writeFileSync(prePath, `${JSON.stringify(pre, null, 2)}\n`);
  }

  let status: number | null = 1;
  try {
    // Changesets publishes prereleases under pre.json's tag; OIDC then authorizes one atomic publish operation.
    status = spawnSync(process.execPath, [npmCli, 'run', 'release'], { stdio: 'inherit' }).status;
  } finally {
    if (originalPre) writeFileSync(prePath, originalPre);
  }
  if (status !== 0) process.exit(status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) publish();
