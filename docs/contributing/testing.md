# Testing contributions

Run `npm test` for behavior suites, `npm run typecheck` for TypeScript, `npm run build:packages` for package output, `npm run docs:check` for documentation, and `npm run bench` for performance-sensitive work.

Reproduce bugs with a failing test, prefer real integrations over mocks, and include request-isolation or browser coverage when changing SSR or hydration. Run `git diff --check` before submitting.
