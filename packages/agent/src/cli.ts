/**
 * nod-agent CLI.
 *   nod-agent key
 *   nod-agent request --vendor <addr> --sats <n> --purpose "<text>" [--expiry 1h] [--name <agent>] [--app-url <url>] [--json]
 *   nod-agent status <id|hash> [--json]
 *   nod-agent list [--json]
 */
import { parseArgs } from 'node:util';
import { nodNetwork } from './config.js';
import { checkStatus, createPaymentRequest, listRequests, parseDuration } from './core.js';
import { agentAddress, loadAgentKey } from './keys.js';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Nod agent tool: your agent asks, you nod, BCH settles.

Usage:
  nod-agent key                                   Show the agent public key (creates one on first use)
  nod-agent request --vendor <cashaddr> --sats <n> --purpose "<text>"
                    [--expiry 1h] [--name "<agent name>"] [--app-url <url>] [--buyer <cashaddr>] [--json]
                                                  Sign a payment request and print the approval link
  nod-agent status <id|hash> [--json]             Check on chain whether a request was paid
  nod-agent list [--json]                         List requests created by this agent

Environment:
  NOD_NETWORK     chipnet (default) | mainnet
  NOD_BASE_URL    approval app URL (default http://localhost:5173)
  NOD_AGENT_KEY   64-hex agent key (default: ~/.nod/agent.key, created on first use)
  NOD_HOME        directory for agent.key and requests.json (default ~/.nod)
  NOD_AGENT_NAME  label shown to the approver (default "Nod agent")`;

const OPTIONS = {
  vendor: { type: 'string' },
  sats: { type: 'string' },
  purpose: { type: 'string' },
  expiry: { type: 'string' },
  expires: { type: 'string' },
  name: { type: 'string' },
  'app-url': { type: 'string' },
  'base-url': { type: 'string' },
  buyer: { type: 'string' },
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

export const runCli = async (
  argv: string[],
  io: Io = defaultIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> => {
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
        const network = nodNetwork(env);
        const info = {
          publicKey: key.publicKey,
          address: agentAddress(key.publicKey, network),
          network,
          source: key.source,
          ...(key.path ? { path: key.path } : {}),
        };
        if (values.json) {
          io.out(JSON.stringify(info, null, 2));
        } else {
          if (key.source === 'created') io.out(`Created a new agent key at ${key.path}`);
          io.out(`Agent public key: ${info.publicKey}`);
          io.out(`Agent address:    ${info.address} (identity only; the agent never holds funds)`);
          io.out(`Network:          ${network}`);
          io.out(`Key source:       ${key.source === 'env' ? 'NOD_AGENT_KEY' : key.path}`);
        }
        return 0;
      }
      case 'request': {
        if (!values.vendor || !values.sats || !values.purpose) {
          throw new Error('request needs --vendor, --sats and --purpose');
        }
        if (!/^\d+$/.test(values.sats)) throw new Error('--sats must be a whole number of satoshis');
        const expiry = values.expiry ?? values.expires;
        const baseUrl = values['app-url'] ?? values['base-url'];
        const record = createPaymentRequest({
          vendor: values.vendor,
          sats: Number(values.sats),
          purpose: values.purpose,
          ...(expiry ? { expiresIn: parseDuration(expiry) } : {}),
          ...(values.name ? { agentName: values.name } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(values.buyer ? { buyer: values.buyer } : {}),
          env,
        });
        const req = record.signed.req;
        if (values.json) {
          io.out(
            JSON.stringify(
              { id: record.id, hash: record.hash, link: record.link, network: record.network, expiry: req.expiry },
              null,
              2,
            ),
          );
        } else {
          const sats = 'sats' in req.amount ? req.amount.sats : '?';
          io.out(`Request ${record.id} signed (${record.network}).`);
          io.out(`  ${sats} sats to ${req.vendor}`);
          io.out(`  for: ${req.purpose}`);
          io.out(`  expires: ${new Date(req.expiry * 1000).toISOString()}`);
          io.out('');
          io.out('Send this link to the person who approves (one tap in their wallet):');
          io.out(record.link);
          io.out('');
          io.out(`Check later with: nod-agent status ${record.id.slice(0, 8)}`);
        }
        return 0;
      }
      case 'status': {
        const target = rest[0];
        if (!target) throw new Error('status needs a request id or hash');
        const s = await checkStatus(target, { env });
        if (values.json) {
          io.out(JSON.stringify(s, null, 2));
        } else {
          io.out(`Request ${s.id} (${s.network}): ${s.status.toUpperCase()}`);
          if (s.txid) io.out(`  txid: ${s.txid}`);
          if (s.explorerUrl) io.out(`  explorer: ${s.explorerUrl}`);
          if (s.reasons) io.out(`  receipt problems: ${s.reasons.join(', ')}`);
          if (s.status !== 'paid') io.out(`  approval link: ${s.link}`);
        }
        return s.status === 'paid' ? 0 : 1;
      }
      case 'list': {
        const items = listRequests(env);
        if (values.json) {
          io.out(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          io.out('No requests yet. Create one with: nod-agent request --vendor ... --sats ... --purpose ...');
        } else {
          for (const r of items) {
            const state = r.paidTxid ? `paid ${r.paidTxid.slice(0, 12)}...` : r.expired ? 'expired' : 'open';
            io.out(
              `${r.id.slice(0, 8)}  ${String(r.sats ?? '?').padStart(8)} sats  ${r.network.padEnd(7)}  ${state.padEnd(20)}  ${r.purpose}`,
            );
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
