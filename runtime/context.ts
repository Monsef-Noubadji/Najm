/**
 * Context — dependency injection down the component tree — v1.0 Phase 2.2
 * =================================================================
 * Prop-drilling is fine for two levels and a maintenance liability past
 * three; every mature framework ends up with a provide/inject escape
 * hatch (React context, Vue provide/inject, Angular DI). Najm's version
 * is built on the SAME ownership tree signals.ts already uses for
 * effect disposal — context values are attached to the current Owner
 * scope and inherited down it, so "down the component tree" has a
 * precise, existing meaning in this codebase: descendants in the
 * reactivity graph's ownership tree, which for Najm components IS the
 * DOM subtree (createRoot() gives each mounted component exactly one
 * such scope).
 *
 * This is deliberately NOT React's module-level Context object with a
 * Provider component: Najm has no JSX children/slots in v1.0/Beta, so
 * "wrap children in a Provider" has no template syntax to hang off of
 * yet. Instead, `provide()`/`inject()` are imperative calls made during
 * component setup — same capability, shaped for a framework where the
 * component body already IS the setup phase.
 */
import { currentOwner } from './signals';

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T | undefined;
}

/** Create a typed context handle. `name` is for error messages only. */
export function createContext<T>(name: string, defaultValue?: T): Context<T> {
  return { id: Symbol(name), defaultValue };
}

/**
 * Publish a value on the CURRENT owner scope (must be called during a
 * component's setup — i.e. inside createRoot()/mountComponent()).
 * Every descendant scope — nested effects, child islands mounted from
 * within this one — can read it via inject().
 */
export function provide<T>(ctx: Context<T>, value: T): void {
  const owner = currentOwner();
  if (!owner) {
    throw new Error(
      '[najm] provide() called outside a component scope — call it during ' +
        'component setup, before the view is returned'
    );
  }
  owner.provide(ctx.id, value);
}

/**
 * Read a value published by the nearest ancestor provide() call, walking
 * up the ownership tree. Falls back to the context's default, then
 * throws if neither exists — a missing provider is a programming error,
 * not a value that should silently become `undefined`.
 */
export function inject<T>(ctx: Context<T>): T {
  const owner = currentOwner();
  const found = owner?.lookup(ctx.id);
  if (found) return found.value as T;
  if (ctx.defaultValue !== undefined) return ctx.defaultValue;
  throw new Error(
    `[najm] inject(): no provider found for context "${String(ctx.id.description)}" ` +
      'and it has no default value'
  );
}
