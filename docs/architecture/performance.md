# Performance architecture

Najm minimizes work structurally: static HTML requires no component runtime, islands load independently, and signal bindings update concrete targets. Benchmarks cover zero-JavaScript output, hydration scaling, and signal latency.

Run `npm run bench` and compare against `benchmarks/baseline.json`. Report environment and variance. See [RFC-0014](/rfcs/RFC-0014-performance-benchmarks).
