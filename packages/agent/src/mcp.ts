/**
 * Minimal Model Context Protocol server (JSON-RPC 2.0, newline-delimited over stdio).
 * Hand-written so the package has no SDK dependency. Logs go to stderr only.
 */
import { MAX_PURPOSE_LENGTH } from '@nod/protocol';
import { nodNetwork } from './config.js';
import { checkStatus, createPaymentRequest, listRequests, parseDuration, type StatusOptions } from './core.js';

export const SERVER_INFO = { name: 'nod', version: '0.1.0' };
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
/** Versions whose tool features match ours; anything else gets the default. */
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

export const TOOLS = [
  {
    name: 'nod_request_payment',
    description:
      'Ask a human to approve a Bitcoin Cash payment to a vendor. Signs a Nod request with the agent key ' +
      '(the agent never holds funds) and returns an approval link. Show the link to the user; they approve ' +
      'with one tap in their own wallet and the payment goes straight to the vendor with an on-chain receipt. ' +
      'Afterwards call nod_payment_status with the returned id.',
    inputSchema: {
      type: 'object',
      properties: {
        vendor: {
          type: 'string',
          description: 'Vendor cashaddr: bchtest:... on chipnet (default) or bitcoincash:... on mainnet',
        },
        sats: { type: 'integer', minimum: 546, description: 'Amount in satoshis (min 546, the dust limit)' },
        purpose: {
          type: 'string',
          maxLength: MAX_PURPOSE_LENGTH,
          description: 'Short reason shown to the approver, e.g. "1 weather API call"',
        },
        expires_in: { type: 'string', description: 'How long the request stays valid: 30m, 1h (default), 2d' },
        agent_name: { type: 'string', description: 'Label shown to the approver (default from NOD_AGENT_NAME)' },
      },
      required: ['vendor', 'sats', 'purpose'],
      additionalProperties: false,
    },
  },
  {
    name: 'nod_payment_status',
    description:
      'Check on chain whether a Nod request was paid. Returns paid / unpaid / expired, plus the txid and an ' +
      'explorer link once paid. A valid payment carries an OP_RETURN "NOD" memo committing to the exact signed request.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Request id or hash (or a unique prefix of 4+ chars)' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'nod_list_requests',
    description: 'List the payment requests this agent created, newest first, with their paid state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpContext {
  env?: NodeJS.ProcessEnv;
  /** Passed to checkStatus (tests inject a fake chain). */
  status?: Omit<StatusOptions, 'env'>;
}

const textResult = (t: string, isError = false) => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`"${name}" must be a non-empty string`);
  return v;
};

const callTool = async (name: string, args: Record<string, unknown>, ctx: McpContext) => {
  const env = ctx.env ?? process.env;
  switch (name) {
    case 'nod_request_payment': {
      const sats = typeof args.sats === 'string' && /^\d+$/.test(args.sats) ? Number(args.sats) : args.sats;
      if (typeof sats !== 'number') throw new Error('"sats" must be an integer');
      const record = createPaymentRequest({
        vendor: str(args.vendor, 'vendor'),
        sats,
        purpose: str(args.purpose, 'purpose'),
        ...(args.expires_in !== undefined ? { expiresIn: parseDuration(str(args.expires_in, 'expires_in')) } : {}),
        ...(args.agent_name !== undefined ? { agentName: str(args.agent_name, 'agent_name') } : {}),
        env,
      });
      const req = record.signed.req;
      const details = {
        id: record.id,
        hash: record.hash,
        network: record.network,
        link: record.link,
        vendor: req.vendor,
        amount: req.amount,
        purpose: req.purpose,
        expiresAt: new Date(req.expiry * 1000).toISOString(),
      };
      return textResult(
        `Payment request signed. Ask the user to open this link and approve it in their wallet:\n${record.link}\n\n` +
          JSON.stringify(details, null, 2),
      );
    }
    case 'nod_payment_status': {
      const s = await checkStatus(str(args.id, 'id'), { ...ctx.status, env });
      const head =
        s.status === 'paid'
          ? `PAID on ${s.network}: ${s.explorerUrl}`
          : s.status === 'expired'
            ? 'EXPIRED without a payment. Create a new request if it is still needed.'
            : `UNPAID so far. The user can approve here: ${s.link}`;
      return textResult(`${head}\n\n${JSON.stringify(s, null, 2)}`);
    }
    case 'nod_list_requests': {
      const items = listRequests(env);
      return textResult(items.length === 0 ? 'No requests yet.' : JSON.stringify(items, null, 2));
    }
    default:
      return null;
  }
};

/** Handle one JSON-RPC message. Returns the response, or null for notifications. */
export const handleMessage = async (msg: RpcMessage, ctx: McpContext = {}): Promise<Json | null> => {
  if (typeof msg !== 'object' || msg === null) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  const id = (msg.id ?? null) as Json;
  const ok = (result: unknown): Json => ({ jsonrpc: '2.0', id, result: result as Json });
  const fail = (code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (typeof msg.method !== 'string') return isRequest ? fail(-32600, 'Invalid request') : null;
  if (!isRequest) return null; // notifications (initialized, cancelled, ...) need no reply

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      const protocolVersion =
        typeof asked === 'string' && SUPPORTED_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL_VERSION;
      let network = 'chipnet';
      try {
        network = nodNetwork(ctx.env ?? process.env);
      } catch {
        /* reported on the first tool call */
      }
      return ok({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          `Nod lets you pay for things without holding money (network: ${network}). Call nod_request_payment, ` +
          'show the returned link to the user so they can approve in their own wallet, then call nod_payment_status.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof name !== 'string') return fail(-32602, 'Missing tool name');
      try {
        const result = await callTool(name, args, ctx);
        return result ? ok(result) : fail(-32602, `Unknown tool: ${name}`);
      } catch (e) {
        return ok(textResult(`Error: ${e instanceof Error ? e.message : String(e)}`, true));
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
};

/** Run the server on stdin/stdout until stdin closes. */
export const serveStdio = (ctx: McpContext = {}): void => {
  let buffer = '';
  let queue = Promise.resolve();
  const send = (obj: Json) => process.stdout.write(`${JSON.stringify(obj)}\n`);

  const handleLine = async (line: string) => {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const batch = (Array.isArray(parsed) ? parsed : [parsed]) as RpcMessage[];
    for (const m of batch) {
      const res = await handleMessage(m, ctx).catch((e: unknown): Json => {
        process.stderr.write(`nod-mcp: ${e instanceof Error ? e.stack : String(e)}\n`);
        return { jsonrpc: '2.0', id: (m?.id ?? null) as Json, error: { code: -32603, message: 'Internal error' } };
      });
      if (res) send(res);
    }
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      queue = queue.then(() => handleLine(line));
    }
  });
  process.stdin.on('end', () => {
    const rest = buffer;
    buffer = '';
    if (rest.trim() !== '') queue = queue.then(() => handleLine(rest));
  });
  process.stderr.write(`nod-mcp: ready (${SERVER_INFO.name} ${SERVER_INFO.version})\n`);
};
