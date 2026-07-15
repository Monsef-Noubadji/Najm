# Published CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@monsef-nbj/najm@1.1.0-rc.0` as the installable framework package with published `najm` and `create-najm-app` binaries.

**Architecture:** Keep runtime exports stable while adding Node-only CLI entries to the runtime package build. The CLI resolves consumer apps from `process.cwd()`, delegates dev/build/preview to the server package, scaffolds one pnpm-first template, and verifies the package through packed clean-room adoption before RC publication.

**Tech Stack:** TypeScript, ESM, tsup, Node.js `>=20`, pnpm for generated apps, existing framework packages, existing node:assert test style.

## Global Constraints

- `@monsef-nbj/najm@1.1.0-rc.0` becomes the umbrella framework package.
- Keep existing runtime API: `@monsef-nbj/najm` and `@monsef-nbj/najm/core`.
- Add `bin.najm -> dist/cli.js` and `bin.create-najm-app -> dist/create-app.js`.
- CLI entries must stay isolated from browser/runtime graph.
- `@monsef-nbj/najm` depends on `@monsef-nbj/najm-compiler`, `@monsef-nbj/najm-router`, and `@monsef-nbj/najm-server`.
- `vite` remains a peer dependency.
- Node support remains `>=20`.
- `najm test` remains deferred.
- Project creation writes one default template, then runs `pnpm install`.
- Do not promise bare `npx create-najm-app my-app` or bare `pnpm dlx create-najm-app my-app`.
- Use dependency-free CLI parsing.
- Unknown commands, unknown flags, missing required arguments, invalid ports, and unexpected extra arguments exit non-zero with concise usage.
- Release evidence must include CLI tests, package smoke tests, packed install, clean-room adopter, full tests, typecheck, and docs build.

---

## File Structure

- Create `cli/args.ts`: dependency-free argument parsing, port validation, usage helpers.
- Modify `cli/najm.ts`: cwd-based command dispatch, `create` alias, `--help`, `--version`, deferred `test`, process-safe server delegation.
- Create `cli/create-app.ts`: standalone `create-najm-app` bin wrapper.
- Modify `cli/scaffold.ts`: package version injection, generated scripts/deps, pnpm install execution and failure reporting.
- Modify `cli/doctor.ts`: ensure diagnostics evaluate `process.cwd()` app roots and align messages with the spec.
- Modify `cli/lint.ts`: ensure lint evaluates consumer `src/` roots.
- Modify `packages/najm/package.json`: add bins, deps, peer deps, exports, files, version.
- Modify `packages/najm/tsup.config.ts`: build runtime plus CLI entries.
- Modify package manifests for coordinated `1.1.0-rc.0` versions.
- Modify `tests/test-cli.ts`: add red-first coverage for package bins, cwd behavior, aliases, version/help/errors, pnpm scaffold install.
- Modify `tests/test-package-smoke-script.ts`: smoke packed CLI bins and runtime export isolation.
- Modify docs in `docs/guide/getting-started.md`, `docs/guide/cli.md`, `docs/reference/packages.md`, and `docs/guide/release-status.md`.
- Create `docs/releases/1.1.0-rc.0-cli-evidence.md`: record evidence gate results.

---

### Task 1: Red Tests For Published CLI Contract

**Files:**
- Modify: `tests/test-cli.ts`
- Modify: `tests/test-package-smoke-script.ts`

**Interfaces:**
- Consumes: existing `runCli(args)` helper in `tests/test-cli.ts`.
- Produces: failing assertions that define published CLI behavior before implementation.

- [ ] **Step 1: Add failing CLI contract tests**

Add tests to `tests/test-cli.ts` for:

```ts
await test('najm --help exits 0 and lists create, doctor, lint, preview, and deferred test', () => {
  const { stdout, status } = runCli(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /najm create <dir>/);
  assert.match(stdout, /najm doctor/);
  assert.match(stdout, /najm lint/);
  assert.match(stdout, /najm preview/);
  assert.match(stdout, /najm test/);
});

await test('najm --version prints the runtime package version', () => {
  const { stdout, status } = runCli(['--version']);
  assert.equal(status, 0);
  assert.match(stdout.trim(), /^1\.1\.0-rc\.0$/);
});

await test('najm test is explicitly deferred', () => {
  const { stdout, stderr, status } = runCli(['test']);
  assert.notEqual(status, 0);
  assert.match(`${stdout}\n${stderr}`, /najm test is deferred for this release/);
});

await test('najm create <dir> scaffolds through the primary alias', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najm-create-primary-test-'));
  const target = path.join(tmp, 'primary-app');
  try {
    const { status, stdout, stderr } = runCli(['create', target], { timeout: 120_000 });
    assert.equal(status, 0, `stdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'package.json')));
    assert.ok(fs.existsSync(path.join(target, 'pnpm-lock.yaml')), 'create should run pnpm install');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test('invalid --port values fail before spawning servers', () => {
  for (const value of ['0', '65536', 'abc', '3.14']) {
    const { stdout, stderr, status } = runCli(['dev', '--port', value]);
    assert.notEqual(status, 0);
    assert.match(`${stdout}\n${stderr}`, /--port must be an integer between 1 and 65535/);
  }
});

await test('unknown flags and unexpected extra args fail with usage', () => {
  const unknownFlag = runCli(['doctor', '--json']);
  assert.notEqual(unknownFlag.status, 0);
  assert.match(`${unknownFlag.stdout}\n${unknownFlag.stderr}`, /unknown option "--json"/);

  const extraArg = runCli(['build', 'extra']);
  assert.notEqual(extraArg.status, 0);
  assert.match(`${extraArg.stdout}\n${extraArg.stderr}`, /unexpected argument "extra"/);
});
```

- [ ] **Step 2: Add failing package smoke expectations**

In `tests/test-package-smoke-script.ts`, add assertions that after `npm run build:packages` and package packing, `packages/najm/package.json` exposes:

```ts
assert.equal(pkg.bin.najm, './dist/cli.js');
assert.equal(pkg.bin['create-najm-app'], './dist/create-app.js');
assert.ok(pkg.dependencies['@monsef-nbj/najm-compiler']);
assert.ok(pkg.dependencies['@monsef-nbj/najm-router']);
assert.ok(pkg.dependencies['@monsef-nbj/najm-server']);
assert.ok(pkg.peerDependencies.vite);
```

Also assert built files exist:

```ts
assert.ok(fs.existsSync(path.join(repoRoot, 'packages', 'najm', 'dist', 'cli.js')));
assert.ok(fs.existsSync(path.join(repoRoot, 'packages', 'najm', 'dist', 'create-app.js')));
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npx tsx tests/test-cli.ts
npx tsx tests/test-package-smoke-script.ts
```

Expected: `test-cli.ts` fails on missing `create`, `--version`, deferred `test`, port validation, or pnpm lockfile. `test-package-smoke-script.ts` fails on missing `bin` and missing built CLI entries.

- [ ] **Step 4: Commit red tests**

```powershell
git add tests/test-cli.ts tests/test-package-smoke-script.ts
git commit -m "test: define published CLI contract"
```

---

### Task 2: Package Runtime Plus CLI Binaries

**Files:**
- Create: `cli/create-app.ts`
- Create: `cli/args.ts`
- Modify: `cli/najm.ts`
- Modify: `packages/najm/package.json`
- Modify: `packages/najm/tsup.config.ts`

**Interfaces:**
- Produces: `main(argv: string[], opts?: { cwd?: string }): Promise<number>`.
- Produces: `runCreateApp(argv: string[], opts?: { cwd?: string }): Promise<number>`.
- Produces: built `dist/cli.js` and `dist/create-app.js`.

- [ ] **Step 1: Create argument parser**

Create `cli/args.ts`:

```ts
export interface ParsedCommand {
  command: string | undefined;
  args: string[];
  flags: Record<string, string | true>;
}

export function parseArgv(argv: string[]): ParsedCommand {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], args: positionals.slice(1), flags };
}

export function rejectUnknownFlags(flags: Record<string, string | true>, allowed: string[]): string | undefined {
  for (const key of Object.keys(flags)) {
    if (!allowed.includes(key)) return `unknown option "--${key}"`;
  }
  return undefined;
}

export function parsePort(value: string | true | undefined): { ok: true; port?: string } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (value === true || !/^\d+$/.test(value)) return { ok: false, message: '--port must be an integer between 1 and 65535.' };
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return { ok: false, message: '--port must be an integer between 1 and 65535.' };
  }
  return { ok: true, port: String(numeric) };
}
```

- [ ] **Step 2: Add standalone create wrapper**

Create `cli/create-app.ts`:

```ts
#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scaffoldApp } from './scaffold';

const require = createRequire(import.meta.url);

function version(): string {
  return require('../packages/najm/package.json').version;
}

function usage(): void {
  console.log(`usage: create-najm-app <dir>

commands:
  create-najm-app <dir>  scaffold a new Najm project and run pnpm install

options:
  --help                 show help
  --version              print version
`);
}

export async function runCreateApp(argv: string[], opts: { cwd?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const [first, second] = argv;
  if (first === '--help' || first === '-h') {
    usage();
    return 0;
  }
  if (first === '--version') {
    console.log(version());
    return 0;
  }
  if (!first) {
    usage();
    return 1;
  }
  if (second) {
    console.error(`unexpected argument "${second}"`);
    usage();
    return 1;
  }
  try {
    const target = path.resolve(cwd, first);
    const result = await scaffoldApp(target, { install: true, packageVersion: version() });
    console.log(`\n  Najm project created in ${result.dir}\n`);
    return result.installOk ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runCreateApp(process.argv.slice(2)).then((code) => process.exit(code));
```

- [ ] **Step 3: Rework main CLI dispatch**

Modify `cli/najm.ts` so it imports `parseArgv`, `rejectUnknownFlags`, `parsePort`, and `scaffoldApp`. Ensure all command roots use `process.cwd()` or `opts.cwd`, not `path.dirname(import.meta.url)`.

The dispatch must include:

```ts
case 'create':
case 'create-najm-app':
  return cmdCreate(rest, cwd);
case 'test':
  console.error("najm test is deferred for this release. Use your project's package.json test script.");
  return 1;
case '--version':
  console.log(version());
  return 0;
```

For `dev` and `preview`, call `parsePort(flags.port)` and reject unknown flags before spawning. For `build`, `doctor`, and `lint`, reject all flags and extra args.

- [ ] **Step 4: Wire package bins and deps**

Modify `packages/najm/package.json`:

```json
{
  "version": "1.1.0-rc.0",
  "bin": {
    "najm": "./dist/cli.js",
    "create-najm-app": "./dist/create-app.js"
  },
  "dependencies": {
    "@monsef-nbj/najm-compiler": "1.1.0-rc.0",
    "@monsef-nbj/najm-router": "1.1.0-rc.0",
    "@monsef-nbj/najm-server": "1.1.0-rc.0"
  },
  "peerDependencies": {
    "vite": ">=5"
  }
}
```

Keep existing exports for `.`, `./core`, and `./package.json`.

- [ ] **Step 5: Build CLI entries with tsup**

Modify `packages/najm/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: '../../runtime/index.ts',
    cli: '../../cli/najm.ts',
    'create-app': '../../cli/create-app.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  banner: {
    js: '#!/usr/bin/env node',
  },
  splitting: false,
  external: [
    '@monsef-nbj/najm-compiler',
    '@monsef-nbj/najm-router',
    '@monsef-nbj/najm-server',
    'vite',
  ],
});
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm run build --workspace @monsef-nbj/najm
npx tsx tests/test-package-smoke-script.ts
```

Expected: package smoke tests pass or fail only on scaffold behavior still covered in Task 3.

- [ ] **Step 7: Commit packaging**

```powershell
git add cli/create-app.ts cli/args.ts cli/najm.ts packages/najm/package.json packages/najm/tsup.config.ts tests/test-package-smoke-script.ts
git commit -m "feat: publish CLI binaries from runtime package"
```

---

### Task 3: Cwd-Based Diagnostics, Lint, Server Delegation, And Scaffold Install

**Files:**
- Modify: `cli/scaffold.ts`
- Modify: `cli/doctor.ts`
- Modify: `cli/lint.ts`
- Modify: `cli/najm.ts`
- Modify: `tests/test-cli.ts`

**Interfaces:**
- Produces: `scaffoldApp(targetDir, options?: { install?: boolean; packageVersion?: string }): Promise<ScaffoldResult>`.
- Produces: `ScaffoldResult.installOk: boolean`.
- Produces: cwd-based `runDoctor(root)` and `lintDir(srcDir)` usage through CLI.

- [ ] **Step 1: Update scaffold types and package JSON generation**

Modify `cli/scaffold.ts`:

```ts
export interface ScaffoldResult {
  dir: string;
  filesWritten: string[];
  installOk: boolean;
}

export interface ScaffoldOptions {
  install?: boolean;
  packageVersion?: string;
}
```

Change `packageJson(appName)` to `packageJson(appName, version)` and generate:

```ts
dependencies: {
  '@monsef-nbj/najm': version,
  '@monsef-nbj/najm-compiler': version,
  '@monsef-nbj/najm-router': version,
  '@monsef-nbj/najm-server': version,
  vite: '^6.0.0',
},
devDependencies: {
  tsx: '^4.19.2',
  typescript: '^5.7.2',
},
scripts: {
  dev: 'najm dev',
  build: 'najm build',
  preview: 'najm preview',
  lint: 'najm lint',
  doctor: 'najm doctor',
  test: 'tsx tests/test-example.ts',
},
```

- [ ] **Step 2: Run pnpm install from scaffold**

In `cli/scaffold.ts`, import `spawnSync` and add:

```ts
function runPnpmInstall(targetDir: string): boolean {
  const result = spawnSync('pnpm', ['install'], {
    cwd: targetDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}
```

In `scaffoldApp`, after writing files:

```ts
let installOk = true;
if (options.install ?? false) {
  installOk = runPnpmInstall(targetDir);
  if (!installOk) {
    console.error(`Project files were created, but \`pnpm install\` failed. Resolve the package-manager error, then run \`pnpm install\` in ${targetDir}.`);
  }
}
return { dir: targetDir, filesWritten: files.map(([rel]) => rel), installOk };
```

If `spawnSync` reports `ENOENT`, print:

```ts
console.error(`Project files were created, but pnpm was not found. Install pnpm, then run \`pnpm install\` in ${targetDir}.`);
```

- [ ] **Step 3: Make CLI commands use cwd roots**

In `cli/najm.ts`, use:

```ts
const cwd = opts.cwd ?? process.cwd();
const result = runDoctor(cwd);
const diagnostics = lintDir(path.join(cwd, 'src'));
```

For server delegation, spawn or import built server package entries with `cwd` set to the consumer app root.

- [ ] **Step 4: Add cwd fixture tests**

In `tests/test-cli.ts`, create a temp app with `src/pages/index.najm`, run `doctor` and `lint` using a helper that accepts `cwd`, and assert it does not inspect the framework repo.

```ts
function runCliIn(cwd: string, args: string[], opts: { timeout?: number } = {}) {
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: opts.timeout ?? 60_000,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? -1 };
}
```

Expected assertions:

```ts
const doctor = runCliIn(target, ['doctor']);
assert.equal(doctor.status, 0);
assert.doesNotMatch(doctor.stdout, /local framework source found/);

const lint = runCliIn(target, ['lint']);
assert.equal(lint.status, 0);
assert.match(lint.stdout, /no problems found/);
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx tsx tests/test-cli.ts
```

Expected: all CLI tests pass.

- [ ] **Step 6: Commit behavior**

```powershell
git add cli/scaffold.ts cli/doctor.ts cli/lint.ts cli/najm.ts tests/test-cli.ts
git commit -m "feat: make CLI operate on consumer projects"
```

---

### Task 4: Coordinate RC Versions And Docs

**Files:**
- Modify: `packages/najm-compiler/package.json`
- Modify: `packages/najm-router/package.json`
- Modify: `packages/najm-server/package.json`
- Modify: `packages/najm/CHANGELOG.md`
- Modify: `packages/najm-compiler/CHANGELOG.md`
- Modify: `packages/najm-router/CHANGELOG.md`
- Modify: `packages/najm-server/CHANGELOG.md`
- Modify: `docs/guide/getting-started.md`
- Modify: `docs/guide/cli.md`
- Modify: `docs/reference/packages.md`
- Modify: `docs/guide/release-status.md`

**Interfaces:**
- Consumes: CLI behavior from Tasks 2-3.
- Produces: docs that an engineer can follow exactly for clean-room adoption.

- [ ] **Step 1: Bump coordinated package versions**

Set each package manifest version to:

```json
"version": "1.1.0-rc.0"
```

Keep dependency versions coordinated at `1.1.0-rc.0`.

- [ ] **Step 2: Update CLI docs**

In `docs/guide/cli.md`, document:

```md
pnpm dlx @monsef-nbj/najm create my-app
cd my-app
pnpm run doctor
pnpm run dev
pnpm run build
pnpm run preview
```

Include the non-promise:

```md
Najm does not publish a separate unscoped `create-najm-app` package in this release, so use `pnpm dlx @monsef-nbj/najm create my-app`.
```

- [ ] **Step 3: Update getting started**

In `docs/guide/getting-started.md`, make the first project setup path:

```md
pnpm dlx @monsef-nbj/najm create my-app
cd my-app
pnpm run dev
```

- [ ] **Step 4: Update package reference**

In `docs/reference/packages.md`, state:

```md
`@monsef-nbj/najm` is both the runtime package and the umbrella CLI package. Runtime imports stay at `@monsef-nbj/najm` or `@monsef-nbj/najm/core`; CLI commands are exposed through the package's `najm` and `create-najm-app` bins.
```

- [ ] **Step 5: Update release status**

In `docs/guide/release-status.md`, add:

```md
## 1.1.0-rc.0 CLI hardening

The next RC promotes the CLI from repo-internal `tsx cli/najm.ts` usage to published package binaries. `najm test` remains deferred.
```

- [ ] **Step 6: Run docs checks**

Run:

```powershell
npm run docs:build
npx tsx tests/test-docs-content.ts
npx tsx tests/test-docs-api-coverage.ts
```

Expected: docs build and docs tests pass.

- [ ] **Step 7: Commit versions and docs**

```powershell
git add packages docs
git commit -m "docs: document published CLI adoption"
```

---

### Task 5: Package, Clean-Room Adoption, And Evidence

**Files:**
- Create: `docs/releases/1.1.0-rc.0-cli-evidence.md`
- Modify: any source files needed for issues found by evidence.

**Interfaces:**
- Consumes: built package tarballs.
- Produces: evidence report with commands, outcomes, and blockers or pass status.

- [ ] **Step 1: Build packages**

Run:

```powershell
npm run build:packages
```

Expected: all package builds pass and `packages/najm/dist/cli.js` plus `packages/najm/dist/create-app.js` exist.

- [ ] **Step 2: Pack packages**

Run:

```powershell
npm pack --workspaces --if-present
```

Expected: tarballs are created for all four packages.

- [ ] **Step 3: Test installed binary from packed package**

Create a temp folder outside the repo, install packed tarballs with pnpm, and run:

```powershell
pnpm exec najm --version
pnpm exec najm --help
pnpm exec create-najm-app --help
```

Expected: version prints `1.1.0-rc.0`; help commands exit `0`.

- [ ] **Step 4: Create clean-room adopter project**

Create a new folder under:

```text
C:\Users\nouba\projects\najm-cli-rc-adopter
```

Use the docs command path where possible. If true `pnpm dlx` requires registry publication, use local packed tarball execution and record that distinction in evidence.

- [ ] **Step 5: Follow docs as a regular engineer**

Inside the adopter project, run:

```powershell
pnpm run doctor
pnpm run lint
pnpm run build
pnpm run preview
```

Verify a rendered route over HTTP:

```powershell
Invoke-WebRequest http://localhost:4173/ -UseBasicParsing
```

Expected: HTTP `200` and rendered Najm HTML.

- [ ] **Step 6: Run full verification**

Run:

```powershell
npm run typecheck
npm test
npm run docs:build
npx tsx tests/test-package-smoke-script.ts
```

Expected: all pass.

- [ ] **Step 7: Write evidence report**

Create `docs/releases/1.1.0-rc.0-cli-evidence.md` with:

```md
# Najm 1.1.0-rc.0 CLI Evidence

## Summary

Status: pass or blocked

## Package Evidence

- `npm run build:packages`: result
- `npm pack --workspaces --if-present`: result
- packed binary smoke: result

## Clean-Room Adoption

- location: `C:\Users\nouba\projects\najm-cli-rc-adopter`
- creation command: command used
- `pnpm run doctor`: result
- `pnpm run lint`: result
- `pnpm run build`: result
- `pnpm run preview`: result
- HTTP verification: result

## Repo Verification

- `npm run typecheck`: result
- `npm test`: result
- `npm run docs:build`: result
- `npx tsx tests/test-package-smoke-script.ts`: result

## Notes

Any blockers, fixes made during evidence, or registry-only `pnpm dlx` limitations.
```

- [ ] **Step 8: Commit evidence**

```powershell
git add docs/releases/1.1.0-rc.0-cli-evidence.md
git commit -m "docs: record CLI rc evidence"
```

---

### Task 6: Final Release Readiness Check

**Files:**
- Modify: only files needed for last-minute fixes found by verification.

**Interfaces:**
- Produces: clean branch ready for review, RC publication decision, or merge.

- [ ] **Step 1: Check working tree**

Run:

```powershell
git status --short --branch
```

Expected: clean branch after commits.

- [ ] **Step 2: Check final diff**

Run:

```powershell
git log --oneline --decorate -n 8
git diff origin/main...HEAD --stat
```

Expected: design, tests, implementation, docs, and evidence commits are present.

- [ ] **Step 3: Run verification-before-completion**

Use `superpowers:verification-before-completion` before claiming the work is complete.

- [ ] **Step 4: Hand off**

Report:

```text
Branch:
Commits:
Evidence:
Remaining blocker status:
Recommended next action:
```
