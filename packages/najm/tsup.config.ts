import { defineConfig } from 'tsup';

export default defineConfig({
  // src/ is runtime/ after the repo migration (see packages/README.md)
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
