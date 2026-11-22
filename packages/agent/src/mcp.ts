/**
 * Minimal Model Context Protocol server (JSON-RPC 2.0, newline-delimited over stdio).
 * Hand-written so the package has no SDK dependency. Logs go to stderr only.
 */
import { MAX_MERCHANT_LENGTH, MAX_PURPOSE_LENGTH } from '@nod/protocol';
import type { Env } from './config.js';
import { checkStatus, createPaymentRequest, listRequests, parseDuration, type StatusOptions } from './core.js';

export const SERVER_INFO = { name: 'nod', version: '0.2.0' };
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
/** Versions whose tool features match ours; anything else gets the default. */
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

export const TOOLS = [
  {
    name: 'nod_request_payment',
    description:
      'Ask a person to approve a stablecoin payment. Signs Nod payment terms (recipient, USD amount, purpose, ' +
      'expiry) with the agent key (the agent never holds funds) and returns an approval link plus the termsHash. ' +
      'Show the link to the user: they connect their own wallet and sign one HSP payment authorization; HSP ' +
      'settles the transfer and the receipt is anchored on HSK Chain. Afterwards call nod_payment_status with the termsHash.',
    inputSchema: {
      type: 'object',
      properties: {
        payTo: { type: 'string', description: 'Recipient 0x address (EVM), e.g. the vendor being paid' },
        amountUsd: { type: 'string', description: 'Amount in USD with at most 2 decimals, e.g. "0.10" (max 10000)' },
        purpose: {
          type: 'string',
          maxLength: MAX_PURPOSE_LENGTH,
          description: 'Short reason shown to the approver, e.g. "1 weather API call"',
        },
        merchant: {
          type: 'string',
          maxLength: MAX_MERCHANT_LENGTH,
          description: 'Name shown to the approver as the one asking (default from NOD_AGENT_NAME)',
        },
        expiresIn: { type: 'string', description: 'How long the terms stay valid: 30m, 1h (default), 2d' },
      },
      required: ['payTo', 'amountUsd', 'purpose'],
      additionalProperties: false,
    },
  },
  {
    name: 'nod_payment_status',
    description:
      'Check whether Nod payment terms were paid: asks the Nod server for the receipt it anchored in the ' +
      'NodReceipts contract on HSK Chain. Returns paid / unpaid / expired, plus the settlement transaction once paid.',
    inputSchema: {
      type: 'object',
      properties: {
        termsHash: { type: 'string', description: 'termsHash returned by nod_request_payment (0x + 64 hex)' },
        id: { type: 'string', description: 'Terms id, or a unique prefix of 4+ hex chars of the id or termsHash' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'nod_list_requests',
    description: 'List the payment terms this agent created, newest first, with their paid state.',
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
  env?: Env;
  /** Passed to checkStatus (tests inject fetch). */
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
      const amountUsd = typeof args.amountUsd === 'number' ? args.amountUsd : str(args.amountUsd, 'amountUsd');
      const record = await createPaymentRequest({
        payTo: str(args.payTo, 'payTo'),
        amountUsd,
        purpose: str(args.purpose, 'purpose'),
        ...(args.merchant !== undefined ? { merchant: str(args.merchant, 'merchant') } : {}),
        ...(args.expiresIn !== undefined ? { expiresIn: parseDuration(str(args.expiresIn, 'expiresIn')) } : {}),
        env,
      });
      const t = record.signed.terms;
      const details = {
        termsHash: record.termsHash,
        id: record.id,
        link: record.link,
        merchant: t.merchant,
        payTo: t.payTo,
        amountUsd: t.amountUsd,
        purpose: t.purpose,
        agent: t.agent,
        expiresAt: new Date(t.expiry * 1000).toISOString(),
      };
      return textResult(
        `Payment terms signed. Ask the user to open this link and approve the payment in their wallet:\n${record.link}\n\n` +
          JSON.stringify(details, null, 2),
      );
    }
    case 'nod_payment_status': {
      const target = args.termsHash !== undefined ? str(args.termsHash, 'termsHash') : args.id !== undefined ? str(args.id, 'id') : undefined;
      if (!target) throw new Error('Pass "termsHash" (or "id")');
      const s = await checkStatus(target, { ...ctx.status, env });
      const head =
        s.status === 'paid'
          ? `PAID${s.settlementUrl ? `: ${s.settlementUrl}` : ''}`
          : s.status === 'expired'
            ? 'EXPIRED without a payment. Create new terms if it is still needed.'
            : s.status === 'unknown'
              ? `UNKNOWN: ${s.note ?? 'the Nod server cannot look up receipts'}`
              : `UNPAID so far.${s.link ? ` The user can approve here: ${s.link}` : ''}`;
      return textResult(`${head}\n\n${JSON.stringify(s, null, 2)}`);
    }
    case 'nod_list_requests': {
      const items = listRequests(env);
      return textResult(items.length === 0 ? 'No payment terms yet.' : JSON.stringify(items, null, 2));
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
      return ok({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Nod lets you get paid, or pay for things, without holding money yourself. Call nod_request_payment ' +
          'with the recipient address, the USD amount and the purpose; show the returned link to the user so they ' +
          'can approve in their own wallet (HSP settles it, the receipt lands on HSK Chain); then call ' +
          'nod_payment_status with the termsHash.',
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
