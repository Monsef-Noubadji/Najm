# Contributing to Najm

Thank you for helping make Najm dependable for application engineers. Read the [complete contributor guide](https://monsef-noubadji.github.io/Najm/contributing/) before substantial work.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build:packages
npm run docs:check
```

Create a focused branch, add a failing test for behavior changes, and keep commits reviewable. Update documentation for public behavior and add a Changeset when a published package changes. Performance-sensitive changes should include `npm run bench` results and environment details.

By participating, you agree to the Code of Conduct. Report vulnerabilities privately as described in `SECURITY.md`.
