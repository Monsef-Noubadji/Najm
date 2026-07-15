# Error boundaries

`withErrorBoundary` contains errors raised during setup, rendering, event handling, and reactive work. The boundary receives the error and phase so applications can log useful diagnostics and render a controlled fallback.

Boundaries are not a replacement for request-level HTTP error handling. Place them around independently recoverable interface regions, avoid exposing stack traces to users, and let infrastructure failures reach server observability. Test setup, render, event, and effect failures separately.
