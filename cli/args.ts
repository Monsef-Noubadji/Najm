export interface ParsedCommand {
  command: string | undefined;
  args: string[];
  flags: Record<string, string | true>;
}

export function parseArgv(argv: string[]): ParsedCommand {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals[0], args: positionals.slice(1), flags };
}

export function rejectUnknownFlags(flags: Record<string, string | true>, allowed: string[]): string | undefined {
  for (const key of Object.keys(flags)) {
    if (!allowed.includes(key)) return `unknown option "--${key}"`;
  }
  return undefined;
}

export function parsePort(value: string | true | undefined): { ok: true; port?: string } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (value === true || !/^\d+$/.test(value)) {
    return { ok: false, message: '--port must be an integer between 1 and 65535.' };
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return { ok: false, message: '--port must be an integer between 1 and 65535.' };
  }

  return { ok: true, port: String(numeric) };
}
