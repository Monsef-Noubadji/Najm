/**
 * Najm language server — go-to-definition provider (RFC-0012)
 * =================================================================
 * `Scope.decls: Map<string, ScopeDecl>` (real `compiler/semantics.ts`
 * data, via `extractDocument()`) already knows WHETHER an identifier
 * resolves to a real declaration. What it doesn't carry is WHERE that
 * declaration sits in the source — `Scope` was built to answer
 * compile-time "is this resolved," not editor "jump to it" (RFC-0012's
 * Design section, and its Alternatives section's explicit rejection of
 * growing `Scope` with position data for this one consumer). So this
 * module re-scans `scriptSource` for the declaration's line once
 * `scope.decls` has confirmed the identifier IS a real declaration —
 * this re-scan is the RFC's own specified design, not a workaround.
 */
import type { Location, Position } from 'vscode-languageserver/node';
import { extractDocument } from './extract';
import { offsetToPosition, positionToOffset } from './positions';

/** Extract the identifier (if any) the LSP cursor `position` sits on/within, in `text`. */
export function identifierAtPosition(text: string, position: Position): string | null {
  const offset = positionToOffset(text, position);
  const idRe = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (offset >= start && offset <= end) return m[0];
    if (start > offset) break;
  }
  return null;
}

/**
 * Find the source line where `name` is declared inside `scriptSource`,
 * covering the declaration shapes `compiler/semantics.ts`'s
 * `scanDeclarations()` itself recognizes (see that module's doc comment):
 * `function name(...)`, `const/let name = ...`, and `name` appearing
 * inside a simple destructuring pattern (`const { name } = ...` /
 * `const [name] = ...`). Returns `null` if no declaration line is found
 * (shouldn't happen for a name that's already confirmed to be in
 * `scope.decls`, but this function never throws).
 */
function findDeclarationOffset(scriptSource: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const fnRe = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s+(${escaped})\\s*\\(`);
  const fnMatch = scriptSource.match(fnRe);
  if (fnMatch && fnMatch.index != null) {
    return fnMatch.index + fnMatch[0].indexOf(fnMatch[1], fnMatch[0].indexOf('function'));
  }

  // const/let NAME = ...   (bare identifier target)
  const bareRe = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const|let)\\s+(${escaped})\\s*=`);
  const bareMatch = scriptSource.match(bareRe);
  if (bareMatch && bareMatch.index != null) {
    return bareMatch.index + bareMatch[0].indexOf(bareMatch[1]);
  }

  // const { ..., NAME, ... } = ...  /  const [ ..., NAME, ... ] = ...
  const destructureRe = /(?:^|\n)\s*(?:export\s+)?(?:const|let)\s+(\{[^}=]*\}|\[[^\]=]*\])\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = destructureRe.exec(scriptSource))) {
    const pattern = m[1];
    const patternStart = m.index + m[0].indexOf(pattern);
    const nameRe = new RegExp(`\\b${escaped}\\b`);
    const nameMatch = pattern.match(nameRe);
    if (nameMatch && nameMatch.index != null) {
      return patternStart + nameMatch.index;
    }
  }

  return null;
}

/**
 * Resolve go-to-definition for the identifier at `position` in a `.najm`
 * document. Returns `null` (never throws) when the cursor isn't on an
 * identifier, the identifier doesn't resolve in scope (props param,
 * unknown name, each-block loop var with no single declaration site,
 * etc.), or a declaration line can't be located despite `scope.decls`
 * confirming the name is declared.
 */
export function getDefinition(uri: string, text: string, position: Position): Location | null {
  const doc = extractDocument(text, uri);
  if (!doc) return null;

  const identifier = identifierAtPosition(text, position);
  if (!identifier) return null;

  const decl = doc.scope.decls.get(identifier);
  if (!decl) return null;

  const declOffsetInScript = findDeclarationOffset(doc.scriptSource, identifier);
  if (declOffsetInScript == null) return null;

  const absoluteOffset = doc.scriptStart + declOffsetInScript;
  const pos = offsetToPosition(text, absoluteOffset);
  const endPos = offsetToPosition(text, absoluteOffset + identifier.length);
  return {
    uri,
    range: { start: pos, end: endPos },
  };
}
