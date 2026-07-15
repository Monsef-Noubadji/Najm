# Performance

Najm's primary performance control is architectural: static components emit HTML only, while islands hydrate independently. Prefer `client:visible` for below-the-fold interaction, avoid module-global request state, and keep reactive effects narrowly scoped.

Use `npm run bench` in the framework repository to compare changes against the checked-in benchmark baseline. Treat local timings as directional; record runtime, hardware, sample count, and variance in performance pull requests.
