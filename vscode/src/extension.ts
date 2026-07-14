/**
 * najm-lang extension host entry point (RFC-0013).
 * =================================================================
 * Standard `vscode-languageclient` pattern: `activate()` spawns
 * `language-server/server.ts` (RFC-0012's stdio `vscode-languageserver`
 * server) as a child process and registers it as the LSP client for
 * `.najm` documents, giving diagnostics/go-to-definition/completion
 * through the LSP protocol. `deactivate()` stops the client cleanly.
 *
 * This file is the ONLY new code this RFC adds to the extension host —
 * the existing syntax-highlighting contributions (grammar, language
 * configuration, icon theme, declared in package.json's `contributes`)
 * are untouched and load the same way they always have; this just adds
 * an activation lifecycle alongside them.
 *
 * KNOWN PACKAGING GAP (documented rather than silently ignored, per
 * RFC-0013): the server is run via `tsx language-server/server.ts`,
 * using a relative `../language-server/server.ts` path from this
 * extension's install location (`vscode/` is a direct sibling of
 * `language-server/` at the repo root). That works when this extension
 * is developed/debugged in place inside this repo (F5 / Extension
 * Development Host) — the path resolves and `tsx` is a devDependency of
 * the ROOT package, reachable via `npx`. It does NOT work for a real
 * end user who installs the packaged `.vsix`: the `.vsix` only contains
 * `vscode/`'s own files (no `language-server/`, no root `node_modules`,
 * no `tsx`), so `../language-server/server.ts` won't exist on disk and
 * `npx tsx` cannot assume the user has Node tooling for a
 * TypeScript-source server. Fixing this for real requires
 * bundling a compiled, dependency-inlined copy of the language server
 * INTO the packaged extension (e.g. an esbuild bundle of
 * `language-server/server.ts` shipped under `vscode/dist/server.js` and
 * run with plain `node`) — a real bundling project of its own, out of
 * scope here per this RFC's brief (not overengineered speculatively).
 * Tracked as this RFC's most concrete follow-up rather than left
 * implicit.
 */
import * as path from 'node:path';
import type { ExtensionContext } from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  // Resolve language-server/server.ts relative to this extension's
  // install location. In this repo's own dev/debug layout
  // (`vscode/` sibling to `language-server/`), `context.extensionPath`
  // is `<repo root>/vscode`, so `../language-server/server.ts` reaches
  // the real server. See the packaging-gap note above for why this
  // does not hold for an installed .vsix.
  const serverModule = path.join(context.extensionPath, '..', 'language-server', 'server.ts');

  const runViaTsx = {
    command: 'npx',
    args: ['tsx', serverModule],
    transport: TransportKind.stdio,
  };
  const serverOptions: ServerOptions = {
    run: runViaTsx,
    debug: runViaTsx,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'najm' }],
  };

  client = new LanguageClient(
    'najmLanguageServer',
    'Najm Language Server',
    serverOptions,
    clientOptions
  );

  // Fires off client.start() without blocking activate(); VS Code
  // tracks the returned client via context.subscriptions so it is
  // disposed automatically on deactivation too.
  void client.start();
  context.subscriptions.push({ dispose: () => void client?.stop() });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
