import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('docs/.vitepress/theme/index.ts', 'utf8');
const css = fs.readFileSync('docs/.vitepress/theme/style.css', 'utf8');
const component = fs.readFileSync('docs/.vitepress/theme/components/HomeSignal.vue', 'utf8');

assert.match(index, /DefaultTheme/);
assert.match(index, /HomeSignal/);
assert.match(index, /style\.css/);
assert.match(css, /--vp-c-brand-1/);
assert.match(css, /--najm-gold/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /:focus-visible/);
assert.match(component, /aria-label="Najm compilation and hydration flow"/);
assert.doesNotMatch(index + css + component, /<script[^>]+src=|https:\/\/.*\.js/);

console.log('docs theme: all assertions passed');
