# Release process

Published changes use Changesets. Add a changeset with `npm run changeset`, select affected scoped packages, choose semver impact, and write adopter-facing release notes.

Najm currently uses Changesets prerelease mode for the beta line. Maintainers run `npm run version:packages`, verify `npm run build:packages` and tarballs, then publish with `npm run release`. Check provenance, authentication, and Git tags before announcing a release.
