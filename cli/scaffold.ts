/**
 * create-najm-app <dir> — scaffolding (RFC-0011)
 * =================================================================
 * ONE template — this repo's own src/pages/ shape (a layout.najm, an
 * index.najm, one example island component, one example dynamic
 * route) — copied into a new directory, with a generated package.json
 * pointing at the published @monsef-nbj package names (per
 * packages/README.md) instead of this
 * repo-internal aliases. No Vitest: per
 * RFC-0015, a generated project's tests/ gets one example file in the
 * same framework-free node:assert style tests/test-signals.ts uses,
 * not a Vitest config.
 */
import fs from 'node:fs';
import path from 'node:path';

function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const LAYOUT_NAJM = `export default function RootLayout(props = {}) {
  const children = props.children;
  return {
    template: \`
      <div class="site">
        <nav><a href="/">Home</a></nav>
        {@html children}
      </div>
    \`,
    style: \`
      .site nav { padding: 0.75rem 1.5rem; border-bottom: 1px solid #e5e5e5; font-weight: 600; }
      .site nav a { color: #6d28d9; text-decoration: none; }
    \`,
  };
}
`;

const INDEX_NAJM = `import Counter from "../components/Counter.najm";

export default function HomePage(props = {}) {
  const renderedAt = new Date().toUTCString();

  return {
    template: \`
      <main>
        <h1>Welcome to Najm</h1>
        <p class="meta">Server-rendered at {renderedAt}. This page ships zero JavaScript except the island below.</p>

        <Counter client:load initial={0} />

        <footer>
          <p>Dynamic route demo: <a href="/greet/ada">/greet/ada</a></p>
        </footer>
      </main>
    \`,
    style: \`
      main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      h1 { font-size: 2.5rem; margin: 0 0 0.5rem; }
      .meta { color: #6b7280; font-size: 0.9rem; }
      footer { margin-top: 2rem; font-size: 0.9rem; color: #6b7280; }
    \`,
  };
}
`;

const COUNTER_NAJM = `import { signal } from "@monsef-nbj/najm/core";

/**
 * Example island. Add client:load (or client:visible) on the
 * component's usage site to hydrate it in the browser — without that
 * directive a component renders as static, zero-JS HTML.
 */
export default function Counter(props = {}) {
  const count = signal(props.initial ?? 0);
  const increment = () => count.value++;

  return {
    template: \`
      <button (click)={increment()}>Count: {count}</button>
    \`,
    style: \`
      button { padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #d4d4d4; font: inherit; cursor: pointer; }
    \`,
  };
}
`;

const GREET_NAJM = `<script>
  // Dynamic route: src/pages/greet/[name].najm -> /greet/:name
  const name = props.params.name;
</script>

<template>
  <main>
    <h1>Hello, {name}!</h1>
    <p><a href="/">&larr; home</a></p>
  </main>
</template>

<style>
  main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem; font-family: system-ui, sans-serif; }
</style>
`;

function packageJson(appName: string): string {
  return JSON.stringify(
    {
      name: appName,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: {
        dev: 'najm dev',
        build: 'najm build',
        preview: 'najm preview',
        test: 'tsx tests/test-example.ts',
      },
      dependencies: {
        '@monsef-nbj/najm': '0.3.0-beta.0',
        '@monsef-nbj/najm-compiler': '0.3.0-beta.0',
        '@monsef-nbj/najm-router': '0.3.0-beta.0',
      },
      devDependencies: {
        tsx: '^4.19.2',
        typescript: '^5.7.2',
      },
    },
    null,
    2
  ) + '\n';
}

const TEST_EXAMPLE = `/**
 * Example test — node:assert, no test framework (matches Najm's own
 * tests/ convention; see the najm repo, tests/test-signals.ts).
 */
import assert from 'node:assert/strict';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(\`  ✓ \${name}\`);
}

test('sanity: arithmetic works', () => {
  assert.equal(1 + 1, 2);
});

console.log(\`\\nexample: all \${passed} tests passed\`);
`;

const GITIGNORE = `node_modules/\ndist/\n`;

export interface ScaffoldResult {
  dir: string;
  filesWritten: string[];
}

export function scaffoldApp(targetDir: string): ScaffoldResult {
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`[create-najm-app] target directory ${targetDir} already exists and is not empty`);
  }
  const appName = path.basename(path.resolve(targetDir)) || 'najm-app';

  const files: [string, string][] = [
    ['src/pages/layout.najm', LAYOUT_NAJM],
    ['src/pages/index.najm', INDEX_NAJM],
    ['src/pages/greet/[name].najm', GREET_NAJM],
    ['src/components/Counter.najm', COUNTER_NAJM],
    ['tests/test-example.ts', TEST_EXAMPLE],
    ['package.json', packageJson(appName)],
    ['.gitignore', GITIGNORE],
  ];

  for (const [rel, content] of files) write(targetDir, rel, content);

  return { dir: targetDir, filesWritten: files.map(([rel]) => rel) };
}
