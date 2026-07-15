# Release status

Najm `1.0.0` is the first stable release. The four public package names, export paths, and Tier 1 contracts follow semantic-versioning compatibility guarantees.

## Adoption policy

- Install all four packages at the same stable version and commit the lockfile.
- Review release notes before upgrading.
- Run SSR, hydration, route, and middleware integration tests in CI.
- Treat undocumented internals as unsupported.
- Report security issues privately through GitHub vulnerability reporting.

Stable promotion requires repository tests, API-contract validation, packed and registry consumer tests, benchmarks, documentation checks, and no confirmed Tier 1 regression. There is no arbitrary waiting period and no gate is silently waived.

The stability classification is defined in [RFC-0018](/rfcs/RFC-0018-public-api-stability). Release policy is recorded in [RFC-0019](/rfcs/RFC-0019-release-strategy). The standalone CLI remains deferred and repository-only.
