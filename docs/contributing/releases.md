# Release process

Published changes use Changesets. Add a changeset with `npm run changeset`, select affected scoped packages, choose semver impact, and write adopter-facing release notes.

Najm uses Changesets to keep all four public packages on one version. Stable versions publish under npm's `latest` tag only after maintainers run the complete [1.0 release runbook](./1.0-release), including API, package-consumer, benchmark, documentation, provenance, and registry readback gates.
