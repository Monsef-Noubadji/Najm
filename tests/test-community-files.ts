import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const files = ['CONTRIBUTING.md','CODE_OF_CONDUCT.md','SECURITY.md','.github/PULL_REQUEST_TEMPLATE.md','.github/ISSUE_TEMPLATE/bug.yml','.github/ISSUE_TEMPLATE/feature.yml','.github/ISSUE_TEMPLATE/documentation.yml','.github/ISSUE_TEMPLATE/rfc.yml','.github/ISSUE_TEMPLATE/config.yml','.github/dependabot.yml'];
for (const file of files) assert.ok(existsSync(file), `${file} is required`);
assert.match(readFileSync('.github/ISSUE_TEMPLATE/config.yml','utf8'), /blank_issues_enabled:\s*false/);
for (const file of files.filter(file => file.endsWith('.yml') && file.includes('ISSUE_TEMPLATE') && !file.endsWith('config.yml'))) assert.match(readFileSync(file,'utf8'), /security/i);
const pr = readFileSync('.github/PULL_REQUEST_TEMPLATE.md','utf8');
for (const word of ['test','docs','changeset','benchmark']) assert.match(pr, new RegExp(word,'i'));
assert.match(readFileSync('SECURITY.md','utf8'), /privately report a security vulnerability|private vulnerability reporting/i);
console.log('community files: all assertions passed');
