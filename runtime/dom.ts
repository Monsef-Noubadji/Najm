/**
 * Client-side DOM binding helpers — the *entire* client runtime surface
 * the compiler targets. Note what is absent: there is no component
 * re-render function anywhere in this file. Najm components run ONCE;
 * after that, only these node-level effects ever execute again.
 */
import { Signal, effect } from './signals';
import { toDisplay } from './escape';

/** Keep a text node in sync with a reactive expression. */
export function bindText(node: Text, read: () => unknown): void {
  effect(() => {
    const next = toDisplay(read());
    if (node.data !== next) node.data = next;
  });
}

/** JSX-style attribute semantics: null/false remove, true is bare. */
export function setAttr(el: Element, name: string, value: unknown): void {
  if (value == null || value === false) el.removeAttribute(name);
  else if (value === true) el.setAttribute(name, '');
  else el.setAttribute(name, String(value));
}

/** Keep an attribute in sync with a reactive expression. */
export function bindAttr(el: Element, name: string, read: () => unknown): void {
  effect(() => setAttr(el, name, read()));
}

/** Attach an event listener (compiled from `on:event={handler}`). */
export function listen(el: EventTarget, type: string, handler: EventListener): void {
  el.addEventListener(type, handler);
}

/**
 * Two-way binding for text-ish inputs — the compiled form of
 * `bind:value={sig}`. Vue's `v-model` sugar, built on signals:
 *
 *   model → view: one effect writes sig.value into el.value
 *   view → model: one input listener writes el.value into sig.value
 *
 * The equality gate in the signal setter breaks the feedback loop:
 * typing fires the listener, the write triggers the effect, the effect
 * sees el.value already equals the signal and does nothing.
 */
export function bindValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  sig: Signal<string>
): void {
  const event = el instanceof HTMLSelectElement ? 'change' : 'input';
  listen(el, event, () => {
    sig.value = el.value;
  });
  effect(() => {
    const next = toDisplay(sig.value);
    if (el.value !== next) el.value = next;
  });
}

/** Two-way binding for checkboxes — the compiled form of `bind:checked={sig}`. */
export function bindChecked(el: HTMLInputElement, sig: Signal<boolean>): void {
  listen(el, 'change', () => {
    sig.value = el.checked;
  });
  effect(() => {
    const next = !!sig.value;
    if (el.checked !== next) el.checked = next;
  });
}
