/**
 * A genuine Vue 3 micro-app — composition API + render function —
 * hosted inside a Mono meta-island. (A render function rather than an
 * SFC keeps the toolchain honest: no @vitejs/plugin-vue required.)
 */
import { defineComponent, h, ref } from 'vue';
import { defineVueIsland } from 'mono/interop/vue';

const VueLikes = defineComponent({
  props: {
    label: { type: String, default: 'Vue island' },
  },
  setup(props) {
    const likes = ref(0);
    return () =>
      h('div', { class: 'meta-island vue' }, [
        h('span', { class: 'who' }, `💚 ${props.label} (ref() inside Mono)`),
        h('button', { onClick: () => likes.value++ }, `likes: ${likes.value}`),
      ]);
  },
});

export default defineVueIsland(VueLikes);
