# Compiler API

`compile(source, options)` transforms a `.najm` component into server and client modules. Compiler failures identify invalid template expressions, bindings, or unsupported structure before deployment.

`extractFunctionalParts`, `extractBlocks`, and `parseTemplate` expose pipeline stages for tooling authors. They operate at build time and their intermediate representations should not be persisted as application contracts.

`najm(options)` is the Vite plugin. Import it from `@monsef-nbj/najm-compiler/vite`; configure source matching and compiler plugins in `vite.config.ts`. The `plugin-api` export provides plugin hook types for controlled AST or output transforms. Plugins execute with build-process privileges, so only install trusted plugins.
