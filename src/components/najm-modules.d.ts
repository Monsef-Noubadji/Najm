/**
 * Ambient module shim for importing a .najm file's default export from a
 * plain .ts file (see SafeCrasher.ts). .najm files are compiled by Vite's
 * vite-plugin-najm at build/dev time — tsc never sees their transformed
 * output, so without this declaration `import Crasher from './Crasher.najm'`
 * has no type to resolve. Every compiled functional .najm component's
 * default export satisfies FunctionalComponent (see runtime/mount.ts and
 * RFC-0002's component contract), so that's the type given here.
 */
declare module '*.najm' {
  import type { FunctionalComponent } from '../../runtime/mount';
  const component: FunctionalComponent;
  export default component;
}
