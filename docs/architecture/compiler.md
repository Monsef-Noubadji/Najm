# Compiler architecture

The compiler extracts component blocks, parses templates, resolves identifiers, creates an intermediate representation, and generates SSR plus hydration modules. Semantic analysis prevents unresolved bindings from reaching code generation. Vite integration owns module loading and invalidation.

Start with `compiler/`, [RFC-0003](/rfcs/RFC-0003-compiler-pipeline), and [RFC-0009](/rfcs/RFC-0009-plugin-api). Plugins run between trusted compiler stages and must preserve escaping and ownership invariants.
