# Najm Engineering Documentation Site Design

## Status

Approved for implementation on 2026-07-15.

## Objective

Build and publish a professional, adoption-first documentation site for Najm
at `https://monsef-noubadji.github.io/Najm/`. The site must help application
engineers evaluate Najm, install the beta packages, learn its programming
model, ship an application, and troubleshoot failures before it asks them to
understand framework internals. Architecture records and contribution guidance
remain first-class secondary journeys.

## Audience

The primary audience is application engineers adopting Najm. They need a
progressive path from framework evaluation to production operation, accurate
copy-paste examples, explicit beta limitations, and complete public API
coverage.

The secondary audience is framework contributors. They need repository setup,
architecture orientation, testing and benchmark procedures, RFC governance,
release mechanics, and clear issue and pull-request workflows.

## Technology Choice

Use VitePress as the documentation generator.

VitePress fits the existing Markdown, TypeScript, Vite, and npm toolchain. It
provides static output, local search, syntax highlighting, responsive
navigation, theme extension points, and a direct GitHub Pages deployment path
without introducing a React or Astro application layer.

Astro Starlight was considered but rejected because it adds a second framework
toolchain that does not otherwise serve Najm. Docusaurus was considered but
rejected because its React runtime, configuration surface, and versioning
machinery are unnecessary for the current beta.

## Site Structure

The top-level navigation is:

1. Guide
2. Learn
3. Reference
4. Architecture
5. Contributing

The landing page provides Najm's value proposition, a minimal install command,
a first component, evidence-backed zero-JavaScript and islands claims, package
status, and direct calls to begin the tutorial or inspect GitHub.

### Guide

- Introduction
- Installation
- Create a project
- Project structure
- Development workflow
- First component
- First production build
- Beta status and limitations

### Learn

- Mental model: compiler output instead of Virtual DOM reconciliation
- Components and `.najm` syntax
- Signals, computed values, effects, batching, and ownership
- Lifecycle
- Events and two-way binding
- Store and context
- Error boundaries
- File-based routing
- Layouts and middleware
- Dynamic and catch-all routes
- SSR and static generation
- Islands and hydration strategies
- Compiler plugins

### Guides

Task-oriented pages cover interactive islands, authentication middleware, data
loading, deployment, performance, debugging, troubleshooting, and API
stability. Guides must distinguish implemented behavior from planned work.

### Reference

- Runtime API
- Compiler API
- Router API
- Server entry modules
- CLI reference
- Template syntax
- Package exports
- Configuration and environment variables

Reference content is hand-curated from exported TypeScript surfaces for the
initial beta. Automated TypeDoc generation is deferred because the public API
contract includes semantics and caveats that signatures alone cannot explain.
Every exported package entrypoint must be represented.

### Architecture

- System overview
- Compiler pipeline
- Runtime ownership and scheduler
- SSR, request isolation, and hydration
- Security model
- Performance model and benchmarks
- RFC index and all 20 existing RFCs

The existing RFC files remain canonical. Navigation links to them directly
rather than duplicating their contents.

### Contributing

- Development setup
- Repository map
- Coding conventions
- Test suite
- Browser and benchmark verification
- Documentation contributions
- RFC process
- Changesets and release process
- Pull-request expectations
- Code of Conduct
- Security reporting

## Content Migration

Existing material under `docs/guide/` is retained as source material but
reorganized into adoption-first pages. Existing RFC files remain in place.
Content is edited for consistent terminology, scoped npm package names, beta
status, working links, and executable examples.

The root README becomes a concise project overview that links to the deployed
site. It must not compete with the full documentation or retain stale claims
that packages are unpublished.

## Design System

The visual direction is technical, precise, and recognizably Najm rather than
a generic documentation theme.

- Deep navy backgrounds and warm gold accents evoke navigation by stars.
- Light mode uses warm neutral surfaces rather than pure white.
- Headings use an expressive display typeface; body and code typography remain
  optimized for dense engineering material.
- Code examples, architecture diagrams, measured-result tables, and restrained
  callouts are the primary visual elements.
- The landing page extends the default theme; documentation pages preserve
  familiar sidebar, table-of-contents, breadcrumb, and previous/next behavior.
- Motion is limited to purposeful landing-page entrance transitions and honors
  `prefers-reduced-motion`.
- Both themes meet WCAG AA contrast requirements. Navigation, search, callouts,
  and code controls are keyboard accessible.

The implementation may use CSS gradients, SVG star-field motifs, and native
VitePress theme components. It must not require runtime image-generation
services or remote JavaScript.

## Search and Navigation

Enable VitePress local search so the static site has no external search
service dependency. Configure section sidebars, outline depth, edit links,
last-updated timestamps, social links, and repository links.

The site must use `/Najm/` as its production base path. Internal links and
assets must work both in local development and at the GitHub Pages project URL.

## GitHub Governance

Add:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md` using Contributor Covenant language
- `SECURITY.md` with a private-reporting path and supported-version policy
- `.github/PULL_REQUEST_TEMPLATE.md`
- Issue forms for bugs, feature requests, documentation problems, and RFC
  proposals
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/dependabot.yml`

Templates must request reproduction evidence, affected versions, validation
performed, documentation impact, and changeset requirements where relevant.
They must not solicit secrets or security reports in public issues.

## Build and Deployment

Add root scripts:

- `docs:dev`
- `docs:build`
- `docs:preview`
- `docs:check`

`docs:check` must prove that VitePress builds successfully and that the
generated site has no broken internal links. Documentation code examples that
are already covered by repository tests should reference those tests rather
than introducing duplicate test harnesses.

Add a GitHub Pages workflow that:

1. Runs on relevant pushes to `main` and manual dispatch.
2. Uses npm's lockfile with `npm ci`.
3. Builds the documentation.
4. Uploads the VitePress static output as a Pages artifact.
5. Deploys using GitHub's official Pages actions and least-privilege
   permissions.
6. Uses workflow concurrency to prevent stale simultaneous deployments.

Pull requests run documentation build validation but do not deploy.

## Failure Behavior

- A broken VitePress build or internal link fails CI.
- Missing optional metadata must not prevent local development.
- GitHub Pages deployment never runs from untrusted pull-request code.
- External links are not hard failures because remote availability is outside
  repository control; they may be reported separately.
- Existing framework release and test workflows remain independent.

## Acceptance Criteria

- The site builds from a clean `npm ci` installation.
- The production build works under the `/Najm/` base path.
- The complete primary adoption journey is navigable without reading an RFC.
- All public scoped packages and export subpaths are documented.
- All existing RFCs are reachable from architecture navigation.
- Search returns results across guide, reference, architecture, and
  contribution content.
- Light and dark themes are responsive across desktop and mobile widths.
- Keyboard navigation and reduced-motion behavior are verified.
- Contribution, conduct, security, issue, and pull-request templates exist and
  contain project-specific guidance.
- GitHub Actions publishes the site to
  `https://monsef-noubadji.github.io/Najm/`.
- Existing framework tests and typecheck remain green.

## Deferred Scope

- Versioned documentation for multiple stable major releases
- Translations
- Hosted analytics
- External search services
- Automated TypeDoc page generation
- Interactive browser playground
- Custom documentation domain
