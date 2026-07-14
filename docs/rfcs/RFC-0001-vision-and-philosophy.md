# RFC-0001: Vision & Philosophy

- **Status:** Draft
- **Supersedes:** the multi-framework-orchestration framing from earlier
  brainstorming (Beta's "React/Vue meta-islands" and the v1.0 spec's
  Rust/resumability-in-v1 requirements — see `legacy/README.md`)

## Summary

> Najm is a compiler-first reactive framework that ships JavaScript only
> where user interaction requires it.

Every API, every RFC, every line of code either reinforces this sentence or
it doesn't belong in Najm's core.

## Motivation

Najm's original brainstorming session correctly identified four strong
ideas from four different frameworks — Angular/Solid-style signals,
Vue-style two-way binding, Next-style file-based SSR, Astro-style islands —
and combined them. That combination is still right. What went wrong is
scope creep in the *execution* of that idea: subsequent rounds added
Qwik-style resumability, deep React/Vue runtime embedding, and a
Rust/SWC rewrite, all in the name of "enterprise-readiness," without asking
whether each addition reinforced the core sentence or just added surface
area copied from a competitor.

The architecture review scored this directly: Vision 10/10, but
Maintainability 6/10 and likelihood of reaching v1 5/10. The gap between
those numbers is the whole problem this RFC exists to close.

## Design

### The one-sentence test

Before any subsystem is designed, it must answer: **does this ship less
JavaScript, or does this make the compiler do more work so the runtime does
less?** If a proposed feature doesn't reduce shipped JS and doesn't reduce
runtime responsibility, it needs a different justification or it doesn't
belong in `najm`.

### What Najm is

- **Compiler-first.** The compiler is not a convenience layer over a
  capable runtime (React, Vue) — it is where the complexity lives. Static
  analysis, hoisting, dead-code elimination, and template-to-DOM-operation
  lowering all happen at build time so the runtime doesn't have to.
- **Signals-based, fine-grained.** No Virtual DOM. Updates target the exact
  DOM node/attribute a changed signal is bound to. See RFC-0004.
- **Zero JS by default.** A page with no interactive component ships no
  framework JavaScript at all. Interactivity is opt-in per component
  (islands, RFC-0007), not implied by using the framework.
- **Small core, everything else is a plugin.** `najm` is the
  reactivity primitives, the component/lifecycle contract, and the
  hydration engine — nothing else. Routing, DevTools, testing utilities,
  and any non-DOM-framework interop are packages that depend on core, never
  the reverse. See RFC-0009.

### What Najm is not

- **Not a multi-framework host.** Najm does not run React's or Vue's
  reconciler inside its own render/hydration pipeline. Where interop with
  another framework's component is genuinely needed, it happens through
  the platform's own boundary — a Web Component — never through a
  framework-specific adapter living in `najm`. See RFC-0002.
- **Not resumable in v1.** Qwik-style resumability is real and valuable,
  but it requires serializing execution state, lexical scopes, closures,
  and dependency graphs — a distinct architecture, not a hydration flag.
  It is v2+ research, sequenced after SSR → Islands → Partial Hydration →
  Progressive Hydration are solid. Treating it as a v1 checkbox item was
  the single biggest risk flagged in the architecture review.
- **Not written in Rust to start.** Rust/SWC changes the compiler's
  *performance*, not its *architecture*. Committing to a native rewrite
  before the TypeScript compiler's AST/IR is stable means rewriting a
  moving target. The compiler evolves: TypeScript → stabilize AST →
  introduce IR → *then* Rust, if and when compile time is measured as an
  actual bottleneck. See RFC-0003.
- **Not a kitchen sink.** Angular's dependency injection and hierarchical
  providers are worth borrowing (RFC-0002's context system). Angular's
  decorators, Zone.js, and NgModules are not — they solve problems Najm's
  compiler-first model doesn't have.

## Decision-making rule for every future RFC

An RFC proposing a new subsystem must include a section answering: *what
does this cost the runtime bundle for a user who never uses this feature?*
If the answer isn't "zero, because it's tree-shaken" or "zero, because it's
a separate package," the RFC needs to explain why not before it can be
Accepted.

## Non-goals

- Feature parity with React/Angular/Vue. Najm does not need every API a
  competitor has; it needs every API its own philosophy requires.
- Winning benchmarks Najm's architecture doesn't naturally win. Performance
  work (RFC-0014) targets Najm's actual bottlenecks, not a leaderboard.

## Open questions

- Should `najm` ship a minimal router, or is routing always a
  separate package? RFC-0008 takes a position; this RFC does not
  prejudge it beyond "if it's separate, it must be optional without
  friction."
