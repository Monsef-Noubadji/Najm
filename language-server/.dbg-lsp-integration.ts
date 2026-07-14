/**
 * Manual, one-off stdio JSON-RPC integration check for najm-language-server.
 * NOT part of tests/ / npm test (see this session's report for why: it
 * spawns a real child process and talks LSP framing over real pipes,
 * which is slower and has more moving parts than this repo's other
 * fast, in-process unit suites — kept as a standalone script instead).
 *
 * Spawns language-server/server.ts for real, sends a real `initialize`
 * request, `initialized` notification, and a `textDocument/didOpen` for
 * a fixture with a known typo, then waits for the server's
 * `textDocument/publishDiagnostics` notification and prints the exact
 * wire payloads. Exits 0 and kills the child on success, exits 1 on
 * timeout/mismatch.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const serverPath = path.resolve('language-server/server.ts');
const child = spawn(process.execPath, [
  path.resolve('node_modules/tsx/dist/cli.mjs'),
  serverPath,
], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = Buffer.alloc(0);
let nextId = 1;
const pending = new Map<number, (result: unknown) => void>();
let onNotification: ((method: string, params: unknown) => void) | null = null;

function send(method: string, params: unknown, id?: number): void {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (id != null) msg.id = id;
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  console.log(`>>> SENT: ${method}${id != null ? ` (id=${id})` : ' (notification)'}\n${json}\n`);
  child.stdin.write(header + json);
}

function request(method: string, params: unknown): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send(method, params, id);
  });
}

child.stdout.on('data', (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buf.slice(0, headerEnd).toString('utf8');
    const lengthMatch = header.match(/Content-Length: (\d+)/i);
    if (!lengthMatch) return;
    const length = parseInt(lengthMatch[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + length) return;
    const body = buf.slice(bodyStart, bodyStart + length).toString('utf8');
    buf = buf.slice(bodyStart + length);
    const msg = JSON.parse(body);
    if (msg.id != null && pending.has(msg.id)) {
      console.log(`<<< RECEIVED response for id=${msg.id}\n${JSON.stringify(msg, null, 2)}\n`);
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    } else if (msg.method) {
      console.log(`<<< RECEIVED notification: ${msg.method}\n${JSON.stringify(msg, null, 2)}\n`);
      onNotification?.(msg.method, msg.params);
    }
  }
});

child.stderr.on('data', (d: Buffer) => {
  process.stderr.write(`[server stderr] ${d}`);
});

async function main(): Promise<void> {
  const initResult = await request('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
  });
  console.log('initialize capabilities:', JSON.stringify((initResult as { capabilities: unknown }).capabilities));

  send('initialized', {});

  const uri = 'file:///fixture.najm';
  const text = `export default function Fixture() {
  const count = signal(0);
  return {
    template: \`<p>{cuont}</p>\`,
  };
}
`;

  const diagnosticsPromise = new Promise<{ uri: string; diagnostics: unknown[] }>((resolve) => {
    onNotification = (method, params) => {
      if (method === 'textDocument/publishDiagnostics') {
        resolve(params as { uri: string; diagnostics: unknown[] });
      }
    };
  });

  send('textDocument/didOpen', {
    textDocument: { uri, languageId: 'najm', version: 1, text },
  });

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
  const result = await Promise.race([diagnosticsPromise, timeout]);

  child.kill();

  if (!result) {
    console.error('FAIL: timed out waiting for textDocument/publishDiagnostics');
    process.exit(1);
  }

  const diags = result.diagnostics as Array<{ message: string; range: unknown }>;
  if (diags.length === 1 && /cuont.*is not defined/.test(diags[0].message)) {
    console.log('PASS: received exactly one diagnostic for the known typo, over real stdio JSON-RPC framing.');
    process.exit(0);
  } else {
    console.error('FAIL: unexpected diagnostics payload:', JSON.stringify(diags));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  child.kill();
  process.exit(1);
});
