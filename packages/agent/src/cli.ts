/**
 * nod-agent CLI.
 *   nod-agent key [--json]
 *   nod-agent request --pay-to <0x…> --usd <amount> --purpose "<text>" [--merchant "<name>"] [--expires 1h] [--app-url <url>] [--json]
 *   nod-agent status <termsHash|id> [--json]
 *   nod-agent list [--json]
 */
import { parseArgs } from 'node:util';
import type { Env } from './config.js';
import { checkStatus, createPaymentRequest, listRequests, parseDuration } from './core.js';
import { loadAgentKey } from './keys.js';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Nod agent tool: your agent asks, you nod, HSK Chain settles.

Usage:
  nod-agent key [--json]                           Show the agent address (creates a key on first use)
  nod-agent request --pay-to <0x address> --usd <amount> --purpose "<text>"
                    [--merchant "<name>"] [--expires 1h] [--app-url <url>] [--json]
                                                   Sign payment terms and print the approval link
  nod-agent status <termsHash|id> [--json]         Ask the Nod server whether the terms were paid
  nod-agent list [--json]                          List the terms this agent created

The approver opens the link, connects a wallet and signs one HSP payment authorization;
HSP settles the stablecoin transfer and the Nod server anchors the receipt on HSK Chain.

Environment:
  NOD_BASE_URL    Nod app for links and status checks (default http://localhost:5173)
  NOD_AGENT_KEY   agent private key, 64 hex (default: ~/.nod/agent.key, created on first use)
  NOD_HOME        directory for agent.key and terms.json (default ~/.nod)
  NOD_AGENT_NAME  merchant name shown to the payer when --merchant is not given (default "Nod agent")`;

const OPTIONS = {
  'pay-to': { type: 'string' },
  usd: { type: 'string' },
  purpose: { type: 'string' },
  merchant: { type: 'string' },
  expires: { type: 'string' },
  expiry: { type: 'string' },
  'app-url': { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export const parseCliArgs = (argv: string[]) => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  return { command: positionals[0], rest: positionals.slice(1), values };
};

const defaultIo: Io = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const runCli = async (argv: string[], io: Io = defaultIo, env: Env = process.env, fetchImpl?: typeof fetch): Promise<number> => {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (e) {
    io.err(`nod-agent: ${message(e)}`);
    io.err(USAGE);
    return 2;
  }
  const { command, rest, values } = parsed;
  if (!command || values.help || command === 'help') {
    io.out(USAGE);
    return command || values.help ? 0 : 2;
  }
  try {
    switch (command) {
      case 'key': {
        const key = loadAgentKey(env);
        const info = { address: key.address, source: key.source, ...(key.path ? { path: key.path } : {}) };
        if (values.json) {
          io.out(JSON.stringify(info, null, 2));
        } else {
          if (key.source === 'created') io.out(`Created a new agent key at ${key.path}`);
          io.out(`Agent address: ${key.address}`);
          io.out(`Key source:    ${key.source === 'env' ? 'NOD_AGENT_KEY' : key.path}`);
          io.out('The agent key only signs payment terms; it never holds funds.');
        }
        return 0;
      }
      case 'request': {
        const payTo = values['pay-to'];
        if (!payTo || !values.usd || !values.purpose) throw new Error('request needs --pay-to, --usd and --purpose');
        const expires = values.expires ?? values.expiry;
        const baseUrl = values['app-url'] ?? values['base-url'];
        const record = await createPaymentRequest({
          payTo,
          amountUsd: values.usd,
          purpose: values.purpose,
          ...(values.merchant ? { merchant: values.merchant } : {}),
          ...(expires ? { expiresIn: parseDuration(expires) } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          env,
        });
        const t = record.signed.terms;
        if (values.json) {
          io.out(
            JSON.stringify(
              { id: record.id, termsHash: record.termsHash, link: record.link, agent: t.agent, payTo: t.payTo, amountUsd: t.amountUsd, expiry: t.expiry },
              null,
              2,
            ),
          );
        } else {
          io.out(`Terms ${record.id} signed by agent ${t.agent}.`);
          io.out(`  ${t.amountUsd} USD to ${t.payTo}`);
          io.out(`  from: ${t.merchant}`);
          io.out(`  for: ${t.purpose}`);
          io.out(`  expires: ${new Date(t.expiry * 1000).toISOString()}`);
          io.out(`  termsHash: ${record.termsHash}`);
          io.out('');
          io.out('Send this link to the person who approves (they nod in their own wallet):');
          io.out(record.link);
          io.out('');
          io.out(`Check later with: nod-agent status ${record.termsHash.slice(0, 10)}`);
        }
        return 0;
      }
      case 'status': {
        const target = rest[0];
        if (!target) throw new Error('status needs a termsHash or id');
        const s = await checkStatus(target, { env, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
        if (values.json) {
          io.out(JSON.stringify(s, null, 2));
        } else {
          io.out(`Terms ${s.termsHash}: ${s.status.toUpperCase()}`);
          if (s.receipt) {
            io.out(`  settlement tx: ${s.receipt.settlementTx} (chain ${s.receipt.chainId})`);
            io.out(`  paid by ${s.receipt.payer} to ${s.receipt.payTo}, ${s.receipt.amount} token units`);
          }
          if (s.settlementUrl) io.out(`  explorer: ${s.settlementUrl}`);
          if (s.note) io.out(`  note: ${s.note}`);
          if (s.status !== 'paid' && s.link) io.out(`  approval link: ${s.link}`);
        }
        return s.status === 'paid' ? 0 : 1;
      }
      case 'list': {
        const items = listRequests(env);
        if (values.json) {
          io.out(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          io.out('No terms yet. Create some with: nod-agent request --pay-to 0x... --usd 0.10 --purpose "..."');
        } else {
          for (const r of items) {
            const state = r.paid ? `paid ${r.paid.slice(0, 12)}...` : r.expired ? 'expired' : 'open';
            io.out(`${r.termsHash.slice(0, 10)}  ${r.amountUsd.padStart(9)} USD  ${state.padEnd(20)}  ${r.purpose}`);
          }
        }
        return 0;
      }
      default:
        io.err(`nod-agent: unknown command "${command}"`);
        io.err(USAGE);
        return 2;
    }
  } catch (e) {
    io.err(`nod-agent: ${message(e)}`);
    return 2;
  }
};
