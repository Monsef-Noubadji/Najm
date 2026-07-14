# Mono Framework Architecture Review & Strategic Recommendations

> Audience: Claude Code
>
> Purpose: Use this document as the architectural guidance for evolving the Mono framework. These recommendations supersede earlier brainstorming where conflicts exist.

---

# Executive Summary

Mono has the potential to become an outstanding compiler-first frontend framework. The current vision demonstrates a strong understanding of modern frontend architecture (Signals, SSR, Islands, AOT compilation, developer tooling).

However, the current roadmap attempts to combine the philosophies of React, Angular, Vue, Next.js, Astro, Qwik, and Solid simultaneously. That is the project's biggest architectural risk.

The goal of this document is to reduce long-term complexity while increasing the probability of successfully shipping a production-quality v1.

---

# Overall Evaluation

| Category | Score | Notes |
|-----------|------:|------|
| Vision | 10/10 | Ambitious and coherent |
| Ecosystem understanding | 9/10 | Strong knowledge of modern frameworks |
| Compiler architecture | 8.5/10 | Good direction, missing compiler fundamentals |
| Runtime architecture | 9/10 | Signals + compiler-first is the right path |
| SSR | 9/10 | Strong foundation |
| Developer Experience | 9/10 | Excellent priorities |
| Maintainability | 6/10 | Scope currently too broad |
| Likelihood of reaching v1 | 5/10 | Needs tighter focus |

---

# Core Philosophy (Most Important)

Before implementing additional features, define Mono in a single sentence.

Example:

> Mono is a compiler-first reactive framework that ships JavaScript only where user interaction requires it.

Every future API and architectural decision should reinforce this philosophy.

Do **not** attempt to become "React + Angular + Vue + Next + Astro."

Opinionated frameworks survive.

Kitchen-sink frameworks do not.

---

# Architectural Recommendations

## 1. Signals

Signals should remain the core primitive.

Study and take inspiration primarily from:

- SolidJS
- Preact Signals
- MaverickJS

Avoid copying Angular Signals implementation directly.

---

## 2. Compiler Strategy

Do **not** begin with Rust.

Recommended evolution:

```
TypeScript compiler
    ↓
Validate architecture
    ↓
Stabilize AST
    ↓
Introduce IR
    ↓
Rewrite compiler in Rust
    ↓
Incremental compilation
```

Rust improves performance—not architecture.

---

## 3. Resumability

Current roadmap jumps too early into resumability.

Recommended roadmap:

```
SSR
 ↓
Islands
 ↓
Partial Hydration
 ↓
Progressive Hydration
 ↓
Resumability (v2+)
```

Real resumability requires serializing execution state, lexical scopes, closures, and dependency graphs.

Treat it as a long-term research project.

---

## 4. React & Vue Interoperability

Avoid embedding React or Vue runtimes deeply into Mono.

Instead:

```
Mono Component
      ↓
Web Component
      ↓
React Wrapper
Vue Wrapper
Angular Wrapper
```

This keeps ownership of the DOM clear and dramatically reduces runtime complexity.

---

## 5. Angular Inspiration

Borrow only the strongest ideas.

Keep:

- Dependency Injection
- Hierarchical providers
- Context

Avoid:

- Decorators
- Zone.js
- NgModules

---

# Missing Compiler Layer

Current design skips an Intermediate Representation.

Compiler pipeline should become:

```
Lexer
 ↓
Parser
 ↓
AST
 ↓
Semantic Analysis
 ↓
Intermediate Representation (IR)
 ↓
Optimization
 ↓
Code Generation
```

The IR becomes the foundation for:

- Tree shaking
- Static hoisting
- Server rendering
- Client rendering
- Compiler plugins
- Future optimizations

---

# Runtime Scheduler

Introduce a dedicated scheduler.

Responsibilities:

- effect execution
- batching
- flush timing
- microtasks
- priorities
- rendering queue

Nearly every mature framework eventually introduces one.

---

# Memory Management

Design ownership and cleanup from the beginning.

Areas requiring lifecycle management:

- Signals
- Effects
- Computed values
- Context
- Subscriptions

Avoid memory leaks by implementing ownership trees similar to SolidJS.

---

# Error Boundaries

Introduce first-class error boundaries.

Runtime should support:

- component isolation
- rendering errors
- async errors
- SSR failures

---

# API Organization

Instead of copying React APIs, organize Mono into categories.

## Core

- signal
- computed
- effect
- batch
- memo
- context
- inject
- component

## DOM

- bind
- class
- style
- events
- refs
- portals
- transitions

## Server

- loader
- action
- cache
- cookies
- headers
- redirect
- metadata

## Compiler

- macros
- directives
- transforms
- plugins

## CLI

- dev
- build
- preview
- doctor
- test
- lint

## Runtime

- scheduler
- hydration
- serializer
- router

---

# Plugin Architecture

Everything possible should become a plugin.

Examples:

- Markdown
- SVG
- React
- Vue
- Tailwind
- MDX
- GraphQL
- i18n
- Testing
- Image optimization

Core should remain as small as possible.

---

# Build Graph

Maintain an internal build graph.

```
Source File
      ↓
AST
      ↓
IR
      ↓
Chunk
      ↓
Route
      ↓
Manifest
      ↓
Assets
      ↓
Output
```

This graph powers:

- incremental compilation
- watch mode
- HMR
- caching
- tree shaking
- parallel builds

---

# Observability

Go beyond standard CLI logging.

Example:

```
Parsing ............ 38ms
AST .................12ms
IR ..................4ms
Optimization ........31ms
SSR Generation ......14ms
JS Output ..........18 KB
CSS Output .........2 KB
Hydration ..........0.8 KB
```

Provide:

- compiler graph
- dependency graph
- bundle graph
- hydration graph
- signal graph

---

# Recommended Repository Structure

```
mono/
├── compiler/
│   ├── lexer/
│   ├── parser/
│   ├── ast/
│   ├── ir/
│   ├── optimizer/
│   └── codegen/
├── runtime/
│   ├── signals/
│   ├── scheduler/
│   ├── renderer/
│   ├── hydration/
│   ├── context/
│   └── hooks/
├── router/
├── server/
├── cli/
├── plugins/
├── language-server/
├── vscode/
├── docs/
├── playground/
├── benchmarks/
├── examples/
└── tests/
```

---

# Development Roadmap

## v0.1 – v0.3

- Signals
- Compiler
- Renderer
- SSR
- Basic routing

## v0.4 – v0.6

- Hooks
- Plugin system
- HMR
- Compiler optimizations
- Stable APIs

## v0.7 – v1.0

- DevTools
- CLI
- Language Server
- VSCode extension
- Testing
- Documentation
- Benchmarks

## v2+

Research topics:

- Resumability
- Distributed compilation
- Advanced compiler optimizations
- Cross-framework interoperability

---

# Guidance for Claude

When implementing Mono:

1. Prioritize architecture over features.
2. Minimize runtime size.
3. Push complexity into the compiler.
4. Keep the core runtime extremely small.
5. Build extensibility through plugins.
6. Treat developer experience as a first-class feature.
7. Avoid implementing features simply because another framework has them.
8. Every subsystem must reinforce Mono's central philosophy.

If a proposed feature increases complexity without reinforcing the compiler-first philosophy, challenge it before implementation.
