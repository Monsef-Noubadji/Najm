# Release process

Published changes use Changesets. Add a changeset with `npm run changeset`, select affected scoped packages, choose semver impact, and write adopter-facing release notes.

Najm uses Changesets prerelease mode with the `rc` tag. Release candidates publish under npm's `next` tag; stable versions publish under `latest`. Maintainers run the complete [1.0 release runbook](./1.0-release), including API, package-consumer, benchmark, documentation, provenance, and registry readback gates.
