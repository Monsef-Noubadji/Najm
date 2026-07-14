/**
 * Najm plugin API (RFC-0009) — the type surface a plugin AUTHOR imports.
 * =================================================================
 * `NajmPlugin` is a TYPE `najm-compiler` exports, not a base class or a
 * required import for `najm`/`najm-compiler`'s own code — see
 * RFC-0009's "What najm and najm-compiler do NOT know about
 * plugins" section. `compiler/codegen.ts` and `compiler/plugin.ts` are
 * the only places `NajmPlugin` objects are ever consumed, and they do so
 * generically (iterate `opts.plugins`, call each hook if present).
 */
import type { IRNode } from './ir';
import type { Scope } from './semantics';

export interface NajmPlugin {
  name: string;
  /** Runs after IR lowering (compiler/ir.ts's lowerNodes()), before codegen.
   *  Receives the SAME Scope semantic analysis produced — deps on every
   *  IRDynText/IRDynAttr node are real signal names, not approximations. */
  transformIR?(nodes: IRNode[], scope: Scope): IRNode[];
  /** An additional codegen backend (RFC-0003's "third backend" — Web
   *  Component target, or a plugin-specific one, e.g. a static-analysis
   *  linter backend that never emits runtime code at all). */
  codegen?(nodes: IRNode[], scope: Scope): { code: string } | null;
}
