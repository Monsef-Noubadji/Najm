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
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/rfcs/' },
      { text: 'API status', link: '/rfcs/RFC-0018-public-api-stability' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Components', link: '/guide/components' },
            { text: 'Routing and SSR', link: '/guide/routing-and-ssr' },
            { text: 'CLI', link: '/guide/cli' },
          ],
        },
      ],
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
