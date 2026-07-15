# Najm Engineering Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy an adoption-first engineering documentation site for Najm at `https://monsef-noubadji.github.io/Najm/`, including complete public references and contribution governance.

**Architecture:** VitePress renders the existing Markdown corpus plus new adoption and reference pages from `docs/`. A small custom theme provides Najm's visual identity while retaining VitePress navigation ergonomics and local search. Separate CI and Pages workflows validate pull requests and deploy `docs/.vitepress/dist` from `main`.

**Tech Stack:** VitePress 1.6.4, Vue 3 as VitePress's theme runtime, Markdown, TypeScript, CSS, npm workspaces, GitHub Actions, GitHub Pages.

## Global Constraints

- Primary audience: application engineers adopting Najm.
- Secondary audience: framework contributors and architecture readers.
- Production URL: `https://monsef-noubadji.github.io/Najm/`.
- Production base path: `/Najm/`.
- Package imports use the `@monsef-nbj/*` npm scope.
- Framework brand, CLI command, and file extension remain `Najm`, `najm`, and `.najm`.
- Existing RFC files remain canonical and must not be duplicated.
- Search is VitePress local search; no hosted search or analytics service.
- Both themes meet WCAG AA contrast and honor `prefers-reduced-motion`.
- Do not add TypeDoc, a browser playground, translations, or a custom domain.
- Existing framework tests and release workflow remain independent.

---

### Task 1: Documentation Build Foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/.vitepress/config.mts`
- Create: `docs/index.md`
- Create: `tests/test-docs-config.ts`

**Interfaces:**
- Consumes: Existing Markdown under `docs/guide/` and `docs/rfcs/`.
- Produces: Root scripts `docs:dev`, `docs:build`, `docs:preview`, and `docs:check`; VitePress config with `base: '/Najm/'` and local search.

- [ ] **Step 1: Write the failing configuration test**

Create `tests/test-docs-config.ts` using `node:assert`, matching the repository's test style. Read `package.json` and `docs/.vitepress/config.mts`, then assert:

```ts
assert.equal(pkg.scripts['docs:dev'], 'vitepress dev docs');
assert.equal(pkg.scripts['docs:build'], 'vitepress build docs');
assert.equal(pkg.scripts['docs:preview'], 'vitepress preview docs');
assert.equal(pkg.scripts['docs:check'], 'npm run docs:build');
assert.match(config, /base:\s*['"]\/Najm\/['"]/);
assert.match(config, /provider:\s*['"]local['"]/);
assert.match(config, /Monsef-Noubadji\/Najm/);
```

- [ ] **Step 2: Register and run the failing test**

Append `tsx tests/test-docs-config.ts` to the root `test` script so the suite registration guard covers it.

Run: `npx tsx tests/test-docs-config.ts`

Expected: FAIL because the VitePress scripts and config do not exist.

- [ ] **Step 3: Install VitePress and add scripts**

Run: `npm install --save-dev vitepress@1.6.4`

Add:

```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs",
"docs:check": "npm run docs:build"
```

- [ ] **Step 4: Create the VitePress configuration**

Create `docs/.vitepress/config.mts` with `defineConfig`, `lang: 'en-US'`, title `Najm`, the compiler-first description, `base: '/Najm/'`, clean URLs, last-updated timestamps, local search, GitHub social link, edit links to `main/docs/:path`, footer, outline levels 2-3, and explicit nav/sidebar entries matching Tasks 3-5.

- [ ] **Step 5: Create the minimal landing page**

Create `docs/index.md` with VitePress home frontmatter:

```yaml
layout: home
title: Najm
titleTemplate: Compiler-first reactive framework
hero:
  name: Najm
  text: Ship HTML first. Hydrate only interaction.
  tagline: A compiler-first reactive framework with signals, SSR, and zero-JavaScript-by-default islands.
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: View on GitHub
      link: https://github.com/Monsef-Noubadji/Najm
```

Include feature cards for fine-grained reactivity, static-first SSR, compiler validation, and file routing.

- [ ] **Step 6: Verify build foundation**

Run: `npx tsx tests/test-docs-config.ts`

Expected: PASS.

Run: `npm run docs:build`

Expected: VitePress build exits 0 and creates `docs/.vitepress/dist/index.html`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/.vitepress/config.mts docs/index.md tests/test-docs-config.ts
git commit -m "docs: add VitePress site foundation"
```

### Task 2: Najm Theme and Landing Experience

**Files:**
- Create: `docs/.vitepress/theme/index.ts`
- Create: `docs/.vitepress/theme/style.css`
- Create: `docs/.vitepress/theme/components/HomeSignal.vue`
- Modify: `docs/index.md`
- Create: `tests/test-docs-theme.ts`

**Interfaces:**
- Consumes: VitePress `DefaultTheme`, CSS variables, and home layout from Task 1.
- Produces: Custom theme extension and `<HomeSignal />` landing-page component.

- [ ] **Step 1: Write the failing theme test**

Assert that the theme imports `DefaultTheme`, registers `HomeSignal`, imports `style.css`, defines brand/background/code CSS variables, contains `prefers-reduced-motion`, and avoids remote scripts.

Append `tsx tests/test-docs-theme.ts` to the root `test` script so the suite registration guard covers it.

- [ ] **Step 2: Run the failing test**

Run: `npx tsx tests/test-docs-theme.ts`

Expected: FAIL because the theme files do not exist.

- [ ] **Step 3: Implement the theme extension**

Export a VitePress `Theme` object:

```ts
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import HomeSignal from './components/HomeSignal.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeSignal', HomeSignal);
  },
} satisfies Theme;
```

- [ ] **Step 4: Implement the visual system**

Use CSS variables for navy, warm neutral, gold, cyan, borders, code surfaces, and focus rings. Add a subtle radial star field, a gold/cyan hero glow, responsive feature cards, readable code blocks, visible keyboard focus, and reduced-motion overrides. Do not hide VitePress semantic navigation or outlines.

- [ ] **Step 5: Implement the home technical visual**

`HomeSignal.vue` renders a static accessible diagram showing `signal -> compiler binding -> DOM text` and `HTML -> island trigger -> hydration`. Use semantic HTML and CSS only, with `aria-label="Najm compilation and hydration flow"`.

- [ ] **Step 6: Verify theme**

Run: `npx tsx tests/test-docs-theme.ts && npm run docs:build`

Expected: test passes and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add docs/.vitepress/theme docs/index.md tests/test-docs-theme.ts
git commit -m "docs: add Najm engineering theme"
```

### Task 3: Adoption-First Guide and Learning Path

**Files:**
- Create: `docs/guide/introduction.md`
- Rewrite: `docs/guide/getting-started.md`
- Create: `docs/guide/project-structure.md`
- Create: `docs/guide/production.md`
- Create: `docs/guide/beta-status.md`
- Rewrite: `docs/guide/components.md`
- Rewrite: `docs/guide/routing-and-ssr.md`
- Create: `docs/learn/islands-and-hydration.md`
- Create: `docs/learn/store-and-context.md`
- Create: `docs/learn/error-boundaries.md`
- Create: `tests/test-docs-content.ts`

**Interfaces:**
- Consumes: Existing guides, package manifests, source examples, and RFC-0002 through RFC-0008.
- Produces: A complete adoption journey that does not require RFC reading.

- [ ] **Step 1: Write the failing content coverage test**

Define required files and assert each exists, has exactly one H1, contains no `0.3.0-dev`, `not yet published`, `git clone <this-repo>`, or unscoped `from "najm/core"`, and uses valid scoped install/import examples.

Append `tsx tests/test-docs-content.ts` to the root `test` script.

- [ ] **Step 2: Run the failing test**

Run: `npx tsx tests/test-docs-content.ts`

Expected: FAIL with missing adoption pages and stale content.

- [ ] **Step 3: Write introduction and installation journey**

Explain who Najm is for, its compiler-first mental model, beta constraints, Node 20 requirement, and the four package roles. The install example is:

```bash
npm install @monsef-nbj/najm@beta @monsef-nbj/najm-compiler@beta @monsef-nbj/najm-router@beta @monsef-nbj/najm-server@beta
```

Clearly state that the CLI is repository-only in this beta.

- [ ] **Step 4: Write first-project and production pages**

Document the actual `src/pages`, `src/components`, `layout.najm`, and middleware structure; development commands; static/dynamic route behavior; production output; and server entry modules. Every command must match a root script or public package export.

- [ ] **Step 5: Rewrite core learning pages**

Cover functional and SFC component forms, template syntax, signals, computed values, effects, batching, lifecycle, events, binding, store/context, boundaries, routing, middleware, SSR, `client:load`, and `client:visible`. Use `@monsef-nbj/najm/core` in every public runtime import.

- [ ] **Step 6: Verify adoption content**

Run: `npx tsx tests/test-docs-content.ts && npm run docs:build`

Expected: PASS with no dead internal links reported by VitePress.

- [ ] **Step 7: Commit**

```bash
git add docs/guide docs/learn tests/test-docs-content.ts
git commit -m "docs: write adoption-first Najm guide"
```

### Task 4: Public API and Operations Reference

**Files:**
- Create: `docs/reference/runtime.md`
- Create: `docs/reference/compiler.md`
- Create: `docs/reference/router.md`
- Create: `docs/reference/server.md`
- Rewrite: `docs/guide/cli.md`
- Create: `docs/reference/template-syntax.md`
- Create: `docs/reference/packages.md`
- Create: `docs/reference/configuration.md`
- Create: `docs/guides/deployment.md`
- Create: `docs/guides/performance.md`
- Create: `docs/guides/troubleshooting.md`
- Create: `tests/test-docs-api-coverage.ts`

**Interfaces:**
- Consumes: `runtime/index.ts`, package export maps, compiler/router entry shims, server manifests, CLI source, and benchmark baseline.
- Produces: Hand-curated reference for every public package subpath and adoption-critical operation.

- [ ] **Step 1: Write the failing API coverage test**

Read the four package manifests, collect their export keys, and assert every package/subpath string appears in `docs/reference/packages.md`. Parse exported runtime names from `runtime/index.ts` and assert each named export appears in `docs/reference/runtime.md`.

Append `tsx tests/test-docs-api-coverage.ts` to the root `test` script.

- [ ] **Step 2: Run the failing coverage test**

Run: `npx tsx tests/test-docs-api-coverage.ts`

Expected: FAIL because reference pages do not exist.

- [ ] **Step 3: Write runtime and compiler references**

For each API include signature, purpose, execution environment, ownership or scheduling behavior, errors, and a minimal example. Compiler reference covers `compile`, `extractFunctionalParts`, `extractBlocks`, `parseTemplate`, `najm`, plugin options, and plugin API types.

- [ ] **Step 4: Write router, server, package, and configuration references**

Document `resolvePage`, `listRoutes`, middleware results, all three side-effectful server subpaths, all package export maps, Node/Vite peer requirements, `PORT`, and build output paths. Mark server subpaths as tooling entry modules, not application-import APIs.

- [ ] **Step 5: Write syntax and operational guides**

Document tags, expressions, raw HTML risk, events, binds, each blocks, components, islands, route naming, deployment artifact shape, measured performance baselines, common compiler errors, hydration failures, and request-isolation diagnostics.

- [ ] **Step 6: Verify API coverage**

Run: `npx tsx tests/test-docs-api-coverage.ts && npm run docs:build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/reference docs/guides docs/guide/cli.md tests/test-docs-api-coverage.ts
git commit -m "docs: add complete API and operations reference"
```

### Task 5: Architecture and Contribution Documentation

**Files:**
- Create: `docs/architecture/index.md`
- Create: `docs/architecture/compiler.md`
- Create: `docs/architecture/runtime.md`
- Create: `docs/architecture/ssr-and-hydration.md`
- Create: `docs/architecture/security.md`
- Create: `docs/architecture/performance.md`
- Rewrite: `docs/rfcs/README.md`
- Create: `docs/contributing/index.md`
- Create: `docs/contributing/testing.md`
- Create: `docs/contributing/rfcs.md`
- Create: `docs/contributing/releases.md`

**Interfaces:**
- Consumes: Existing 20 RFCs, repository scripts, tests, benchmarks, and Changesets configuration.
- Produces: Contributor onboarding and architecture navigation while preserving RFCs as canonical records.

- [ ] **Step 1: Add architecture and contributor pages**

Write concise system maps that link to source directories and corresponding RFCs. Contributor pages include exact `npm ci`, `npm test`, `npm run typecheck`, `npm run build:packages`, `npm run bench`, docs checks, Changesets pre-mode, and release procedures.

- [ ] **Step 2: Rework the RFC index for site navigation**

Keep all 20 links and statuses, add reading paths for runtime, compiler, rendering, tooling, and governance, and remove stale unresolved-package wording superseded by scoped publication.

- [ ] **Step 3: Verify RFC reachability**

Run a Node one-liner that extracts `RFC-\d{4}` links from `docs/rfcs/README.md`, verifies 20 unique RFC files exist, and exits nonzero otherwise.

Expected: `20 RFC documents verified`.

- [ ] **Step 4: Build docs**

Run: `npm run docs:build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture docs/contributing docs/rfcs/README.md
git commit -m "docs: add architecture and contributor paths"
```

### Task 6: Repository Governance and Community Templates

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/documentation.yml`
- Create: `.github/ISSUE_TEMPLATE/rfc.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/dependabot.yml`
- Create: `tests/test-community-files.ts`

**Interfaces:**
- Consumes: Contribution procedures from Task 5 and repository commands.
- Produces: GitHub-native issue, PR, conduct, security, and dependency-update workflows.

- [ ] **Step 1: Write the failing governance test**

Assert every required file exists; security config disables blank issues; public issue forms warn against security reports; PR template contains tests, docs, changeset, and benchmark checkboxes; `SECURITY.md` points to GitHub private vulnerability reporting.

Append `tsx tests/test-community-files.ts` to the root `test` script.

- [ ] **Step 2: Run the failing test**

Run: `npx tsx tests/test-community-files.ts`

Expected: FAIL because governance files are missing.

- [ ] **Step 3: Write project governance documents**

`CONTRIBUTING.md` links to the deployed contributor guide and summarizes setup/validation. Use Contributor Covenant 2.1 text with project enforcement contact through GitHub. `SECURITY.md` supports the current beta line and directs reports to GitHub's private vulnerability-reporting interface.

- [ ] **Step 4: Add issue and PR templates**

Bug form requests version, environment, reproduction, expected/actual behavior, and minimal repository. Feature and RFC forms ask for motivation, alternatives, compatibility, performance, and documentation impact. Documentation form asks for URL and proposed correction. PR template requests linked issue, validation commands, docs, changeset, benchmark, and security impact.

- [ ] **Step 5: Configure Dependabot**

Add monthly npm and GitHub Actions updates with a limit of five open PRs and labels `dependencies` plus `documentation` only for docs-related grouping where supported.

- [ ] **Step 6: Verify governance files**

Run: `npx tsx tests/test-community-files.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md .github tests/test-community-files.ts
git commit -m "docs: add contributor governance templates"
```

### Task 7: Documentation CI and GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/docs-check.yml`
- Create: `.github/workflows/docs-pages.yml`
- Modify: `tests/test-docs-config.ts`

**Interfaces:**
- Consumes: `npm run docs:check` and `docs/.vitepress/dist` from Tasks 1-6.
- Produces: PR validation and production deployment to GitHub Pages.

- [ ] **Step 1: Extend the failing workflow test**

Assert `docs-check.yml` runs on pull requests, uses `npm ci` and `npm run docs:check`, and has read-only contents permission. Assert `docs-pages.yml` uses `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`; grants only `contents: read`, `pages: write`, and `id-token: write`; deploys only from `main` or manual dispatch; and uses concurrency.

- [ ] **Step 2: Run the failing workflow test**

Run: `npx tsx tests/test-docs-config.ts`

Expected: FAIL because workflows are missing.

- [ ] **Step 3: Add pull-request docs validation**

Use Node 22, `actions/checkout@v4`, `actions/setup-node@v4` with npm cache, `npm ci`, and `npm run docs:check`. Restrict path triggers to docs, VitePress config/theme, package manifests, and the workflow itself.

- [ ] **Step 4: Add Pages deployment**

Build with Node 22, upload `docs/.vitepress/dist`, and deploy through the `github-pages` environment. Set the environment URL from `steps.deployment.outputs.page_url`. Use `cancel-in-progress: false` deployment concurrency.

- [ ] **Step 5: Verify workflows and full local gate**

Run: `npx tsx tests/test-docs-config.ts`

Expected: PASS.

Run: `npm test && npm run typecheck && npm run docs:check`

Expected: all framework/documentation suites pass, typecheck passes, VitePress build exits 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/docs-check.yml .github/workflows/docs-pages.yml tests/test-docs-config.ts
git commit -m "ci: deploy Najm docs to GitHub Pages"
```

### Task 8: Production Verification and Launch

**Files:**
- Modify: `README.md`
- Modify: `docs/guide/README.md`

**Interfaces:**
- Consumes: Deployed Pages workflow and complete documentation site.
- Produces: Canonical public documentation links and verified production launch.

- [ ] **Step 1: Update repository entrypoints**

Make `README.md` link prominently to `https://monsef-noubadji.github.io/Najm/`, use scoped install commands, remove the stale “from source / packages not published” heading, and keep only a concise development quick start. Make `docs/guide/README.md` redirect readers into `/guide/introduction` through a normal Markdown link rather than duplicating the site index.

- [ ] **Step 2: Run final local verification**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build:packages
npm run docs:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs/guide/README.md
git commit -m "docs: launch Najm engineering documentation"
git push origin main
```

- [ ] **Step 4: Enable and inspect GitHub Pages**

Use `gh api` to confirm the repository Pages build type is `workflow`. If Pages is not configured, call the GitHub Pages API with `build_type: workflow`; do not select branch-based legacy deployment.

- [ ] **Step 5: Wait for deployment by condition**

Use `gh run list --workflow docs-pages.yml` to obtain the run ID, then `gh run watch <run-id> --exit-status`.

Expected: workflow concludes `success`.

- [ ] **Step 6: Verify production site**

Request `https://monsef-noubadji.github.io/Najm/` and verify HTTP 200, page title contains `Najm`, hashed CSS/JS assets load under `/Najm/`, and links to `/Najm/guide/introduction`, `/Najm/reference/runtime`, `/Najm/architecture/`, and `/Najm/contributing/` return 200.

- [ ] **Step 7: Verify repository state**

Run: `git status --short --branch`

Expected: `main` tracks `origin/main` with no working-tree changes.
