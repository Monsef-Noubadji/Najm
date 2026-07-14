# najm-lang — VS Code support for Najm

Language support for `.najm` functional components.

## What you get

- **Syntax highlighting** — Beta `.najm` files are TypeScript modules, so the
  grammar delegates to `source.ts` and layers Najm's DSL on top inside the
  `template:` and `style:` backtick regions:
  - `{expression}` interpolation → highlighted as embedded TypeScript
  - `{#each … as …}` / `{/each}` → control-flow keywords
  - `(click)=`, `on:click=`, `bind:value=` → attribute-name scopes
  - `client:load` → island directive keyword
  - `style:` backtick → embedded CSS
- **Language configuration** — bracket/quote auto-closing (including backticks
  and HTML comments), comment toggling, folding regions.
- **File icons** — the language `icon` field gives `.najm` files the Najm mark
  in any modern VS Code build; the bundled `najm-icons` icon theme is the
  fallback for users who want explorer-wide icons.

## Build & install

```bash
cd tooling/vscode-najm
npm install
npx vsce package                      # → najm-lang-0.2.0.vsix
code --install-extension najm-lang-0.2.0.vsix
```

For local hacking without packaging: **F5** in VS Code with this folder open
launches an Extension Development Host.

## Roadmap

- TextMate injection grammar so `template:` literals highlight inside plain
  `.ts` files too (adapters, tests).
- A language server (`najm-language-server`): template diagnostics from the
  real compiler (`najm-compiler` exports `parseTemplate`), go-to-definition
  from bindings into component scope, and completion for `bind:`/`client:`.
- Emmet passthrough inside template regions.
