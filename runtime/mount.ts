/**
 * Component instantiation & mounting
 * =================================================================
 * The Najm component contract. A functional component is:
 *
 *   (props) => ComponentView
 *
 * where the compiler has already turned the authored
 * `return { template: \`…\` }` into `return { ssr, hydrate }` —
 * closures over the component's own state.
 *
 * Interop with other frameworks (React, Vue, Angular) happens at the
 * Web Component boundary per RFC-0002, not by having their runtimes
 * speak this internal ABI directly — see docs/rfcs/RFC-0002-runtime-architecture.md.
 */
import { createRoot, withEffectObserver } from './signals';
import { ComponentInstance, runWithInstance } from './lifecycle';

export interface ComponentView {
  /** Render this instance to an HTML string (server). */
  ssr(): string | Promise<string>;
  /** Adopt this instance's server-rendered DOM (client). */
  hydrate(root: Element): void | Promise<void>;
}

export type FunctionalComponent = (
  props?: Record<string, unknown>
) => ComponentView;

export interface MountedComponent {
  instance: ComponentInstance;
  /** Dispose every owned effect, then fire onDestroyed. */
  unmount(): void;
}

/**
 * Run a component's setup function against a fresh instance. Hooks
 * registered during setup bind to that instance; signals created during
 * setup are captured by the returned view's closures.
 */
export function instantiate(
  comp: FunctionalComponent,
  props: Record<string, unknown>
): { inst: ComponentInstance; view: ComponentView } {
  const inst = new ComponentInstance();
  const view = runWithInstance(inst, () => comp(props));
  if (!view || typeof view.ssr !== 'function' || typeof view.hydrate !== 'function') {
    throw new Error(
      '[najm] component function must return { template: `...` } ' +
        '(compiled to { ssr, hydrate }) — got ' + String(view)
    );
  }
  return { inst, view };
}

/**
 * Client-side mount: instantiate, hydrate the server DOM inside a root
 * ownership scope, then flip the lifecycle to mounted.
 *
 *  - createRoot gives the instance ONE disposal handle for every effect
 *    its view will ever create (including future list rows).
 *  - withEffectObserver wires every one of those effects to
 *    inst.scheduleUpdated — onUpdated is attached to the reactivity
 *    graph itself.
 */
export async function mountComponent(
  comp: FunctionalComponent,
  root: Element,
  props: Record<string, unknown> = {}
): Promise<MountedComponent> {
  const { inst, view } = instantiate(comp, props);

  const { result, dispose } = createRoot(() =>
    withEffectObserver(
      () => inst.scheduleUpdated(),
      () => view.hydrate(root)
    )
  );
  await result; // meta-island adapters hydrate asynchronously

  inst.markMounted();

  return {
    instance: inst,
    unmount() {
      dispose(); // all owned effects die first…
      inst.runDestroyed(); // …then the hook observes the corpse
    },
  };
}
