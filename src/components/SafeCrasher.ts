/**
 * RFC-0006 demo wrapper: withErrorBoundary(Crasher, onError), re-exported
 * as a plain default export so it can be used as an ordinary template tag
 * (<SafeCrasher />) from src/pages/error-boundary-demo.najm.
 *
 * This lives in a plain .ts module (not a .najm file) because a .najm
 * file requires a <template> block (compiler/parse.ts's extractBlocks
 * throws otherwise) and this module has nothing to template — it's pure
 * wiring. Component-tag resolution doesn't care about the extension:
 * compiler/codegen.ts's scanComponentImports/processScript both key off
 * `import X from '<relative path>'`, and the codegen comment notes this
 * already works for .najm/.ts/.tsx targets (that's how React/Vue
 * meta-island adapters arrive today).
 *
 * Also sidesteps a real compiler constraint: a .najm SFC's <script>
 * block is textually inlined into BOTH the generated ssr() (async) and
 * hydrate() (sync) functions (compiler/codegen.ts's compileSFC), so a
 * top-level `await` in a page's own <script> is a hard syntax error in
 * the hydrate() copy. Doing the wrapping here, once, at plain module
 * scope avoids needing any await in the page at all — $comp()/$island()
 * already await component includes correctly, but only inside the
 * compiler-generated ssr(), never duplicated into hydrate().
 */
import { withErrorBoundary } from 'najm/core';
import Crasher from './Crasher.najm';

export default withErrorBoundary(Crasher, (error, phase) => {
  console.error('[najm] error boundary caught', phase, error);
  return `<div class="crasher-fallback" data-phase="${phase}">Something went wrong rendering this component — showing a fallback instead.</div>`;
});
