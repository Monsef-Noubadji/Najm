# RFC-0015: Testing Strategy

- **Status:** Implemented
- **Depends on:** none (formalizes existing practice)
- **Formalizes:** `tests/*.ts` (11 files, 100 cases including this RFC's
  own gate), the `npm test` script, and the pattern already followed by
  every Verification section in RFC-0001–0008

## Summary

No test framework. Every suite is a standalone `.ts` file run directly by
`tsx`, using `node:assert/strict` and a ~5-line local `test()` helper
(name, run, count, log). `npm test` is a flat `&&`-chain of every suite
file; there is no test discovery, no parallel runner, no watch mode. This
RFC does not introduce any of those — it writes down the conventions
that already produced 97 passing, genuinely load-bearing tests across
eight implemented RFCs, so the pattern is a documented rule instead of an
implicit habit that could drift.

## Motivation

By RFC-0007, ten suite files existed, each written independently (several
by different dispatched agents in the same session) and each landed on
the *same* shape without being told to: a local `test()`/`passed` counter,
`node:assert/strict`, a doc comment stating what the suite proves and
why, a `console.log` summary line matching `"<suite>: all N tests
passed"`. That convergence is the signal this RFC exists to lock in —
not to replace something broken, but to stop it from silently drifting
once more contributors (or agents) touch the suite and have no written
rule to match against. The architecture review's own guidance
(RFC-0001: minimize unnecessary complexity, don't add a dependency
without a reason) argues directly against introducing Vitest/Jest/etc.
for a suite this size that already works.

## Design

### File convention

```text
tests/test-<subsystem>.ts
```

One file per RFC's primary subsystem, not per source file — `test-ir.ts`
covers all of `compiler/ir.ts`'s lowering behavior in one suite,
`test-hoisting.ts` covers the hoisting-specific codegen behavior that
spans `compiler/hoist.ts` and `compiler/codegen.ts` together, because
that's the unit a reader (or an RFC's Verification section) actually
wants to point at. A suite MAY cover more than one RFC if the RFC's
subsystems are tightly coupled (`test-store.ts` covers both the store
and context system, RFC-0002's formalization of both) — the rule is "one
coherent thing a reader would want to run in isolation," not a rigid
1:1 mapping.

### Suite shape (the pattern every existing file already follows)

```ts
/**
 * <One paragraph: what this suite proves and, where non-obvious, why
 * that's the right thing to prove — see test-partial-hydration.ts's
 * header for the fullest example of this.>
 */
import assert from 'node:assert/strict';
// ...imports of the real subsystem under test, never a mock of it...

let passed = 0;
function test(name: string, fn: () => void): void {   // or async, per-file, matching the subsystem
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('<subsystem>: <specific behavior>', () => {
  // real assertion against real code — no framework matcher DSL
});

console.log(`\n<suite-name>: all ${passed} tests passed`);
```

`async function test(...)` (with every call site `await`ed) is the
variant used wherever a suite needs it (`test-lifecycle.ts`,
`test-error-boundary.ts`) — RFC-0007's implementing agent's post-hoc fix
of a suite that defined `async test()` but forgot to `await` its own
calls (caught during independent verification, not by the suite itself)
is the one real failure mode this pattern has: **a test suite's own
`test()`/`passed` harness has no test of itself**, so a suite silently
reporting "all N passed" while an async assertion never actually ran is
a real risk. See Verification below for how this RFC's own gate catches
that class of bug going forward.

### Naming: what an assertion name promises

Every existing test name follows `<subject>: <behavior>` — e.g. `store:
surgical updates — writing one field does not notify a sibling-only
reader`. The colon separates *what's under test* from *the specific
claim*, and the claim is written so that reading just the name (without
the assertion body) tells you what would have to break for it to fail.
Regression tests additionally prefix with `regression:` and name the bug
in the doc comment or inline comment above the assertion
(`test-hoisting.ts`'s `regression: bare static text sibling of a dynamic
element claims via text(), not staticSubtree()` is the concrete example
— it exists because that exact bug was caught live during RFC-0003's IR
migration and fixed).

### The `npm test` gate

```json
"test": "tsx tests/test-a.ts && tsx tests/test-b.ts && ..."
```

Sequential, not parallel, and not glob-discovered — every suite is
listed explicitly. This is deliberate: a new suite file that isn't added
to this chain doesn't run in CI, which is a real failure mode (worse than
a flaky test) that this RFC's Verification section below checks for
directly, rather than assuming glob-discovery would have caught it for
free.

### Verification-section-cites-a-real-file rule

Every RFC's Verification section, starting with RFC-0001, cites a
specific `tests/test-*.ts` file and (where the RFC's implementing work
included live/browser verification) a description of what was manually
observed. This RFC formalizes that as a requirement for any RFC claiming
`Implemented` status: a Verification section that asserts a behavior
without naming the file/test that proves it is not acceptable for
`Implemented` — it's fine for `Draft` (where the behavior may not exist
yet) but not for a status claiming the code is real and correct.

### The CI boundary gate (RFC-0002's `test-runtime-boundary.ts`)

RFC-0002 already implemented the one cross-cutting CI gate this project
needed early: a script (`tests/test-runtime-boundary.ts`) that statically
scans `runtime/` for imports of UI frameworks or of code outside
`runtime/` itself, enforcing RFC-0001's small-core boundary at the
import-graph level rather than by convention alone. This RFC does not
add a second such gate — one exists, is in the suite chain, and is the
template for any future structural rule that's better enforced by a
script than by a code-review habit (a candidate for the future: an
RFC-0009 plugin API gate once plugins exist, verifying a plugin can't
reach into `runtime/` internals it wasn't given).

## Alternatives considered

- **Adopt Vitest (or similar) now.** Rejected for the same reason
  RFC-0001 rejects Rust before the IR is stable: the current approach
  has zero unresolved pain points across eight implemented RFCs — no
  suite has needed mocking, snapshot testing, or parallel execution for
  speed. Revisit if/when a real pain point appears (e.g., suite runtime
  becomes slow enough that sequential `tsx` invocations are the
  bottleneck), not preemptively.
- **One suite file per source file (`signals.ts` → `test-signals.ts`,
  strictly 1:1).** Rejected — `test-hoisting.ts` and `test-ir.ts`
  deliberately overlap in what they exercise (both touch
  `compiler/codegen.ts`) because they're proving different *properties*
  of the same code (hoisting's claim-call-count behavior vs. IR
  lowering's node-shape correctness), and forcing a 1:1 file mapping
  would either merge two suites that read better separately or split one
  suite's cohesive narrative across files with no benefit.

## Verification

- This RFC IS the verification of itself in one sense — it describes
  exactly what already exists and runs. Confirmed by direct inspection:
  `tests/` contains 11 files (`test-error-boundary.ts`,
  `test-hoisting.ts`, `test-ir.ts`, `test-lifecycle.ts`,
  `test-partial-hydration.ts`, `test-router.ts`,
  `test-runtime-boundary.ts`, `test-scheduler.ts`, `test-signals.ts`,
  `test-store.ts`, `test-suite-registration.ts`), every one wired into
  `package.json`'s `test` script, totaling 100 passing assertions
  (`npm test`, full output captured in this session's verification logs).
- The one real gap this RFC's writing surfaced is now closed:
  `tests/test-suite-registration.ts` (3 cases) statically reads
  `package.json`'s `test` script string and asserts every `tests/*.ts`
  file is referenced in it (and, symmetrically, that the script
  references no file that doesn't exist on disk) — the same
  self-referential pattern `test-runtime-boundary.ts` uses for
  import-graph enforcement, applied to suite-registration enforcement.
  Verified to actually catch the violation it exists for, not just pass
  vacuously: temporarily removing `test-store.ts` from the script string
  made the gate fail with a clear, actionable message naming the exact
  missing file; restoring the script made it pass again. **Done.**

## Open questions

- Should the `Verification-section-cites-a-real-file` rule be checked
  automatically (e.g., a script that greps every RFC's Verification
  section for a `tests/test-*.ts` reference)? Currently enforced by
  convention/review only. Worth revisiting once there are enough RFCs
  that manual review of this becomes unreliable.
