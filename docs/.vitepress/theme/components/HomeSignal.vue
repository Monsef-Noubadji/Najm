<template>
  <section class="home-signal" aria-label="Najm compilation and hydration flow">
    <div class="signal-track">
      <span class="signal-node">signal</span><span aria-hidden="true">-&gt;</span>
      <span class="signal-node">compiler binding</span><span aria-hidden="true">-&gt;</span>
      <span class="signal-node signal-node--output">DOM text</span>
    </div>
    <div class="signal-track">
      <span class="signal-node">HTML</span><span aria-hidden="true">-&gt;</span>
      <span class="signal-node">island trigger</span><span aria-hidden="true">-&gt;</span>
      <span class="signal-node signal-node--output">hydration</span>
    </div>
  </section>
</template>
