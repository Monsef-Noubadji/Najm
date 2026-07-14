import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'index.ts',
    middleware: '../../router/middleware.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
