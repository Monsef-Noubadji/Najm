import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: '../../runtime/index.ts',
    cli: '../../cli/najm.ts',
    'create-app': '../../cli/create-app.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  banner: {
    js: '#!/usr/bin/env node',
  },
  splitting: false,
  external: [
    '@monsef-nbj/najm-compiler',
    '@monsef-nbj/najm-router',
    '@monsef-nbj/najm-server',
    'vite',
  ],
});
