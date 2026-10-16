import { parseArgs } from 'node:util';
import { configFromEnv } from '../config.ts';
import { Store } from '../db.ts';
import { DEFAULT_RATE_PER_MINUTE, createApiKey } from '../api/keys.ts';

// pnpm keys create <name> [--rate 120] | pnpm keys list | pnpm keys revoke <id>

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { rate: { type: 'string' }, json: { type: 'boolean' } },
});
const [cmd, arg] = positionals;
const store = new Store(configFromEnv().dbPath);

function usage(): never {
  console.error('Usage:\n  pnpm keys create <name> [--rate <requests per minute>]\n  pnpm keys list\n  pnpm keys revoke <key id>');
  process.exit(1);
}

try {
  if (cmd === 'create') {
    if (!arg) usage();
    const rate = values.rate ? Number(values.rate) : DEFAULT_RATE_PER_MINUTE;
    if (!Number.isFinite(rate) || rate < 1) usage();
    const k = createApiKey(store, arg, rate);
    if (values.json) console.log(JSON.stringify(k));
    else {
      console.log(`Created key ${k.id} for "${k.name}" (${k.ratePerMinute} requests/minute).`);
      console.log('Copy it now; it is not stored and cannot be shown again:\n');
      console.log(`  ${k.key}\n`);
    }
  } else if (cmd === 'list') {
    const rows = store.listApiKeys();
    if (values.json) console.log(JSON.stringify(rows));
    else if (!rows.length) console.log('No API keys.');
    else {
      for (const r of rows) {
        const status = r.revoked ? `revoked ${new Date(r.revoked).toISOString()}` : 'active';
        const used = r.lastUsed ? new Date(r.lastUsed).toISOString() : 'never';
        console.log(`${r.id}  ${r.name.padEnd(20)}  ${String(r.ratePerMinute).padStart(5)}/min  ${status.padEnd(10)}  last used ${used}`);
      }
    }
  } else if (cmd === 'revoke') {
    if (!arg) usage();
    if (store.revokeApiKey(arg)) console.log(`Revoked ${arg}.`);
    else {
      console.error(`No active key ${arg}.`);
      process.exitCode = 1;
    }
  } else usage();
} finally {
  store.close();
}
