# Template syntax

Najm templates use HTML structure with `{expression}` escaped interpolation. Event bindings use `(event)={handler}` and form bindings connect input value or checked state to writable signals. Repeated blocks preserve item ownership; component tags establish child ownership.

Island directives `client:load` and `client:visible` opt a component into hydration. Raw HTML intentionally bypasses escaping and is unsafe for untrusted input. Attribute and text interpolation are escaped by default.
