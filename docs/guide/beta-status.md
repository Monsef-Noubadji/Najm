# Beta status

Najm `0.3.0-beta` is published for engineering evaluation and early adoption. Public package names and documented entry points are intentional, but APIs may change before a stable release.

## Adoption policy

- Pin versions or use a lockfile; do not float production installs on `beta`.
- Review release notes and Changesets before upgrading.
- Run SSR, hydration, route, and middleware integration tests in CI.
- Treat undocumented internals as unstable.
- Report security issues privately through GitHub vulnerability reporting.

The stability classification is defined in [RFC-0018](/rfcs/RFC-0018-public-api-stability). Package publication and naming are recorded in [RFC-0019](/rfcs/RFC-0019-release-strategy).
