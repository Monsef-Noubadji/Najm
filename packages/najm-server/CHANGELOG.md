# @monsef-nbj/najm-server

## 1.0.0-rc.1

### Patch Changes

- Resolve adopter application roots from the working directory and load the runtime through the published `@monsef-nbj/najm/core` export. Published development and production commands now work outside the Najm repository.

## 1.0.0-rc.0

### Major Changes

- Establish the Najm 1.0 public compatibility contract with classified API
  tiers, clean packed-package consumer verification, and version-aware release
  channels. The runtime, compiler, router, and server packages remain a fixed
  version group. The repository CLI and `create-najm-app` remain deferred and
  are not advertised by package manifests.

## 0.3.0

### Patch Changes

- 79b81b1: Prepare the first Najm beta artifacts with verified npm workspace builds,
  public export maps, package documentation, and self-contained tarballs.

## 0.3.0-beta.0

### Patch Changes

- Prepare the first Najm beta artifacts with verified npm workspace builds,
  public export maps, package documentation, and self-contained tarballs.
