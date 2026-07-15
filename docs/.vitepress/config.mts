import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'Najm',
  description: 'A compiler-first reactive framework with signals, SSR, and zero-JavaScript-by-default islands.',
  base: '/Najm/',
  cleanUrls: true,
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#07111f' }]],
  themeConfig: {
    logo: { src: '/najm-mark.svg', alt: 'Najm' },
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/runtime' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Contributing', link: '/contributing/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Project structure', link: '/guide/project-structure' },
            { text: 'Components', link: '/guide/components' },
            { text: 'Routing and SSR', link: '/guide/routing-and-ssr' },
            { text: 'Production', link: '/guide/production' },
            { text: 'Release status', link: '/guide/release-status' },
            { text: 'CLI', link: '/guide/cli' },
          ],
        },
      ],
      '/learn/': [{ text: 'Learn', items: [
        { text: 'Islands and hydration', link: '/learn/islands-and-hydration' },
        { text: 'Store and context', link: '/learn/store-and-context' },
        { text: 'Error boundaries', link: '/learn/error-boundaries' },
      ] }],
      '/reference/': [{ text: 'Reference', items: [
        { text: 'Runtime', link: '/reference/runtime' }, { text: 'Compiler', link: '/reference/compiler' },
        { text: 'Router', link: '/reference/router' }, { text: 'Server', link: '/reference/server' },
        { text: 'Template syntax', link: '/reference/template-syntax' }, { text: 'Packages', link: '/reference/packages' },
        { text: 'Configuration', link: '/reference/configuration' },
      ] }],
      '/architecture/': [{ text: 'Architecture', items: [
        { text: 'System map', link: '/architecture/' }, { text: 'Compiler', link: '/architecture/compiler' },
        { text: 'Runtime', link: '/architecture/runtime' }, { text: 'SSR and hydration', link: '/architecture/ssr-and-hydration' },
        { text: 'Security', link: '/architecture/security' }, { text: 'Performance', link: '/architecture/performance' },
      ] }],
      '/contributing/': [{ text: 'Contributing', items: [
        { text: 'Start contributing', link: '/contributing/' }, { text: 'Testing', link: '/contributing/testing' },
        { text: 'RFCs', link: '/contributing/rfcs' }, { text: 'Releases', link: '/contributing/releases' },
      ] }],
      '/rfcs/': [
        {
          text: 'Architecture record',
          items: [{ text: 'RFC index', link: '/rfcs/' }],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Monsef-Noubadji/Najm' }],
    editLink: {
      pattern: 'https://github.com/Monsef-Noubadji/Najm/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    outline: { level: [2, 3], label: 'On this page' },
    lastUpdated: { text: 'Last updated' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Monsef Noubadji and Najm contributors',
    },
  },
});
