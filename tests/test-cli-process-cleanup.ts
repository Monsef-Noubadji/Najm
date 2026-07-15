import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('tests/test-cli.ts', 'utf8');
assert.match(source, /detached:\s*process\.platform !== ['"]win32['"]/);
assert.match(source, /await terminateProcessTree\(child\)/);
assert.match(source, /process\.kill\(-child\.pid/);
assert.match(source, /once\(child, ['"]exit['"]\)/);

console.log('CLI process cleanup: Unix process-group termination is enforced');
