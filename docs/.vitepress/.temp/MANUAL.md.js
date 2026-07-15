import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Where the documentation moved","description":"","frontmatter":{},"headers":[],"relativePath":"MANUAL.md","filePath":"MANUAL.md","lastUpdated":1784039977000}');
const _sfc_main = { name: "MANUAL.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="where-the-documentation-moved" tabindex="-1">Where the documentation moved <a class="header-anchor" href="#where-the-documentation-moved" aria-label="Permalink to &quot;Where the documentation moved&quot;">​</a></h1><p>The single-file technical manual that used to live here described the Beta architecture (meta-islands, deep React/Vue runtime embedding, resumability as a v1 feature) that was superseded by the architecture review and is now archived — see <a href="https://github.com/Monsef-Noubadji/Najm/blob/main/legacy/README.md" target="_blank" rel="noreferrer">legacy/README.md</a> and <a href="https://github.com/Monsef-Noubadji/Najm/blob/main/legacy/docs/MANUAL.md" target="_blank" rel="noreferrer">legacy/docs/MANUAL.md</a> for the historical version.</p><p>Current architecture documentation is the RFC series: <strong><a href="./rfcs/README">docs/rfcs/README.md</a></strong>, starting with <a href="./rfcs/RFC-0001-vision-and-philosophy">RFC-0001 (Vision &amp; Philosophy)</a>.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("MANUAL.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const MANUAL = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  MANUAL as default
};
