# Troubleshooting

## Compiler errors

Start at the first diagnostic. Check template identifier scope, writable signal use in bindings, balanced blocks, and trusted plugin transforms.

## Hydration mismatch

Compare server HTML with the initial client template. Remove time, randomness, browser-only globals, and cross-request mutable state from render setup. Check repeated-block keys and conditional branches.

## Route not found

Verify file naming, `index.najm`, dynamic bracket syntax, pages root, and case sensitivity on the deployment filesystem.

## Request data leaks

Create stores, contexts, and render roots per request. Use request-isolation tests that render two concurrent identities and assert neither response contains the other identity.
