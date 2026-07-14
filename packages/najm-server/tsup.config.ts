import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    dev: '../../server/dev.ts',
    build: '../../server/build.ts',
    serve: '../../server/serve.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['vite'],
});
