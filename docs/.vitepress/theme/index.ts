import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import HomeSignal from './components/HomeSignal.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeSignal', HomeSignal);
  },
} satisfies Theme;
