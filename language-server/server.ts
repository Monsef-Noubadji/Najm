#!/usr/bin/env node
/**
 * najm-language-server (RFC-0012)
 * =================================================================
 * Standard stdio-based `vscode-languageserver`/`vscode-languageserver-
 * textdocument` Node LSP server — the conventional pattern RFC-0012
 * calls for, and the shape RFC-0013's future VS Code extension LSP
 * client (currently a Stub, blocked on this RFC) expects to spawn.
 *
 * Wires the three capabilities RFC-0012 specifies
 * (`textDocument/publishDiagnostics`, `textDocument/definition`,
 * `textDocument/completion`) to the real providers in
 * `diagnostics.ts`/`definition.ts`/`completion.ts`, which are themselves
 * thin adapters over `compiler/parse.ts`'s `parseTemplate()`/
 * `extractBlocks()` and `compiler/semantics.ts`'s `analyzeSemantics()` —
 * zero forked/duplicated `.najm` parsing or scope-resolution logic
 * anywhere in this file or its imports (RFC-0012's Alternatives
 * section's non-negotiable constraint).
 *
 * This file has no test coverage of its own beyond the manual stdio
 * JSON-RPC integration check (see the RFC's Verification section) —
 * everything it delegates to (extraction, diagnostics, definition,
 * completion) is unit-tested directly in `tests/test-language-server.ts`
 * against the provider functions, which is the layer that actually
 * carries logic; this file is pure protocol wiring.
 */
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import type { InitializeResult } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDiagnostics } from './diagnostics';
import { getDefinition } from './definition';
import { getCompletions } from './completion';

// Explicit stdio wiring (rather than relying on `--stdio`/`--node-ipc`
// CLI flags): this server is always spawned over stdio by its clients
// (RFC-0013's future VS Code extension, and this RFC's own integration
// check), so there is no other transport to select between.
const connection = createConnection(
  ProposedFeatures.all,
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      definitionProvider: true,
      completionProvider: { triggerCharacters: ['{', '<', ':'] },
    },
  };
});

function publishDiagnosticsFor(document: TextDocument): void {
  const diagnostics = getDiagnostics(document.uri, document.getText());
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

documents.onDidOpen((e) => publishDiagnosticsFor(e.document));
documents.onDidChangeContent((e) => publishDiagnosticsFor(e.document));

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  return getDefinition(document.uri, document.getText(), params.position);
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return getCompletions(document.uri, document.getText(), params.position);
});

documents.listen(connection);
connection.listen();
