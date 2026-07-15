# Runtime architecture

Reactive reads connect signals to observers. Owners group effects, lifecycle callbacks, and cleanup. Generated bindings update specific DOM targets rather than rerendering a component tree. Stores and context compose on top of these primitives.

The public surface is assembled in `runtime/index.ts`; implementation lives under `runtime/`. See [RFC-0002](/rfcs/RFC-0002-runtime-architecture), [RFC-0004](/rfcs/RFC-0004-reactivity-system), and [RFC-0005](/rfcs/RFC-0005-scheduler-design).
