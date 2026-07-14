/**
 * vite-plugin-najm — Phase 2 (delivery half)
 * =================================================================
 * One transform hook makes .najm files first-class citizens of Vite's
 * module graph, on BOTH sides of the wire:
 *
 *   server — vite.ssrLoadModule('/src/pages/index.najm') pulls a page
 *            through this transform and executes its ssr() in Node.
 *   client — the island bootstrap does import('/src/…/X.najm?import');
 *            the ?import query tells Vite's transform middleware to run
 *            the request through plugins instead of serving raw bytes,
 *            so the browser receives the compiled hydrate() module.
 *
 * The compiled output may contain TypeScript (user <script> blocks are
 * TS-friendly), so we finish with Vite's esbuild pass to strip types.
 *
 * RFC-0009 (plugins): `opts.plugins` threads straight into `compile()`,
 * which runs each plugin's `transformIR` after IR lowering, before the
 * SSR/hydration backends. Absent/empty `opts.plugins` is a zero-cost
 * no-op — this `transform()` hook's non-plugin behavior is unchanged.
 *
 * Judgment call — where does a plugin's `codegen()` output go? Vite's
 * `transform()` hook returns exactly one code string per module, and
 * RFC-0009 is explicit a plugin's codegen backend is an ADDITIONAL
 * output, never a replacement for the compiled module's own SSR/hydrate
 * exports. There's no single obvious file/module destination for a
 * generic "additional backend" (it could be a lint report, a .d.ts, a
 * Web Component target, ...) and wiring a virtual-module system into
 * Vite's module graph for that is speculative machinery nobody has asked
 * for yet. So v1 takes the simplest honest option: `najm()` accepts an
 * `onPluginCodegen` callback and passes it straight through to
 * `compile()`, which invokes it once per plugin `codegen()` result
 * (plugin name + `{ code }`). The caller decides what "additional
 * output" means for their build (write a side-file, log it, feed a lint
 * report) — `najm()` itself does not write files or emit Vite assets on
 * a plugin's behalf. Revisit only if a real multi-consumer use case
 * shows this callback is insufficient.
 */
import { transformWithEsbuild, type Plugin } from 'vite';
import { compile } from './codegen';
import type { NajmPlugin } from './plugin-api';

export interface NajmPluginOptions {
  plugins?: NajmPlugin[];
  /** See the judgment-call note above: sink for plugin codegen() output. */
  onPluginCodegen?(pluginName: string, result: { code: string }): void;
}

export function najm(opts?: NajmPluginOptions): Plugin {
  let root = process.cwd();
  return {
    name: 'vite-plugin-najm',

    configResolved(config) {
      root = config.root;
    },

    async transform(code, id) {
      const [file] = id.split('?'); // strip ?import / ?t= timestamps
      if (!file.endsWith('.najm')) return null;

      const compiled = compile(code, {
        id: file,
        root,
        plugins: opts?.plugins,
        onPluginCodegen: opts?.onPluginCodegen,
      });
      const result = await transformWithEsbuild(compiled.code, file + '.ts', {
        loader: 'ts',
      });
      return { code: result.code, map: null };
    },
  };
}
