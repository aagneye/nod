/**
 * HSP (HashKey Settlement Platform) Agentic Payment client.
 *
 * `HspClient` is all the routes need: `callTool(name, args)` returning the raw MCP tool result
 * (the @nod/protocol parsers unwrap it). Two implementations:
 *   - LiveHspClient (this file): an MCP client over Streamable HTTP to HSP_MCP_URL. Connects
 *     lazily, reuses the session, logs the live tool list and input schemas once, and shapes
 *     arguments to the live schemas (names, JSON-string vs object, enum spelling).
 *   - MockHspClient (hsp-mock.ts): an in-memory simulation for development (HSP_MODE=mock).
 *
 * HSP only accepts calls from allowlisted public IPs. Connection failures and refusals become
 * HspUnavailableError, which the API answers with 503 { code: 'hsp_unavailable' }.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CompatibilityCallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { HspMode } from './config.js';

export type { HspMode };

export interface HspCallOptions {
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

export interface HspClient {
  readonly mode: HspMode;
  /** Call one HSP tool; resolves with the raw MCP tool result (it may carry `isError: true`). */
  callTool(name: string, args: Record<string, unknown>, options?: HspCallOptions): Promise<unknown>;
  /** Tool names, descriptions and input schemas (connects first in live mode). */
  listTools?(): Promise<HspToolInfo[]>;
  close?(): Promise<void>;
}

/** The HSP Agentic Payment tools Nod calls, in flow order (PROTOCOL §2). */
export const HSP_TOOLS = [
  'get_chain_config',
  'create_order',
  'prepare_payment',
  'finalize_payment',
  'submit_payment',
  'query_payment',
] as const;
export type HspToolName = (typeof HSP_TOOLS)[number];

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  items?: JsonSchema;
  [key: string]: unknown;
}

export interface HspToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const HSP_ALLOWLIST_HINT =
  'HSP only accepts allowlisted IPs: run this server on a machine whose public IP the HSP team has allowlisted ' +
  '(see the standalone server, `npm run serve -w @nod/web`), or set HSP_MODE=mock for development.';

/** HSP could not be reached or refused us (network error, timeout, HTTP 401/403, not allowlisted). */
export class HspUnavailableError extends Error {
  readonly code = 'hsp_unavailable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HspUnavailableError';
  }
}

/** Duck-typed so it survives module reloads in the dev server. */
export const isHspUnavailable = (error: unknown): error is HspUnavailableError =>
  error instanceof HspUnavailableError ||
  (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'hsp_unavailable');

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
]);

/** Text that HSP (or a proxy in front of it) uses when it refuses a caller. */
export const REFUSAL_TEXT =
  /allow-?list|white-?list|\bip\b[^.]{0,40}\b(not|denied|blocked|refused|forbidden|unauthori[sz]ed)\b|access denied|forbidden/i;

const clip = (text: string, max = 200): string => {
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max)}...` : plain;
};

function causeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const httpStatusOf = (error: unknown): number | undefined => {
  if (error instanceof StreamableHTTPError) return error.code;
  if (error instanceof Error && /^(Error POSTing to endpoint|Failed to open SSE stream)/.test(error.message)) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
};

/**
 * Map a transport-level failure to HspUnavailableError (with the allowlist explanation), or
 * return undefined for anything else.
 */
export function toHspUnavailable(error: unknown, url: string): HspUnavailableError | undefined {
  if (isHspUnavailable(error)) return error;
  const where = `HSP at ${url}`;
  const status = httpStatusOf(error);
  if (status !== undefined) {
    const detail = error instanceof Error ? clip(error.message.replace(/^Error POSTing to endpoint:\s*/, '')) : '';
    const refused = status === 401 || status === 403 || status === 407 || status === 451;
    const head = refused ? `${where} refused the connection (HTTP ${status})` : `${where} answered HTTP ${status}`;
    return new HspUnavailableError(`${head}${detail ? `: ${detail}` : ''}. ${HSP_ALLOWLIST_HINT}`, { cause: error });
  }
  if (error instanceof McpError && (error.code === ErrorCode.RequestTimeout || error.code === ErrorCode.ConnectionClosed)) {
    return new HspUnavailableError(`${where} did not answer (${clip(error.message)}). ${HSP_ALLOWLIST_HINT}`, { cause: error });
  }
  if (error instanceof Error) {
    const code = causeCode(error);
    const isAbort = error.name === 'AbortError' || error.name === 'TimeoutError';
    const isFetchFailure = error.name === 'TypeError' && /fetch failed|network/i.test(error.message);
    if (isAbort || isFetchFailure || (code !== undefined && NETWORK_CODES.has(code))) {
      const reason = code ? `${code}` : clip(error.message);
      return new HspUnavailableError(`Could not reach ${where} (${reason}). ${HSP_ALLOWLIST_HINT}`, { cause: error });
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Argument shaping
// ---------------------------------------------------------------------------

const normKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const schemaTypes = (schema: JsonSchema | undefined): string[] =>
  schema?.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];

function coerce(value: unknown, schema: JsonSchema | undefined, key: string, notes: string[]): unknown {
  const types = schemaTypes(schema);
  if (types.length === 0 && !schema?.enum) return value;
  const isObjectLike = typeof value === 'object' && value !== null;
  if (types.includes('string') && !types.includes('object') && !types.includes('array') && isObjectLike) {
    notes.push(`${key}: sent as a JSON string (schema type string)`);
    return JSON.stringify(value);
  }
  if ((types.includes('object') || types.includes('array')) && !types.includes('string') && typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        notes.push(`${key}: sent as parsed JSON (schema type ${types.join('|')})`);
        return parsed;
      }
    } catch {
      // not JSON: leave it as it is
    }
  }
  if ((types.includes('integer') || types.includes('number')) && !types.includes('string') && typeof value === 'string' && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
    notes.push(`${key}: sent as a number`);
    return Number(value);
  }
  if (Array.isArray(schema?.enum) && typeof value === 'string' && !schema.enum.includes(value)) {
    const match = schema.enum.find((option) => typeof option === 'string' && normKey(option) === normKey(value));
    if (typeof match === 'string') {
      notes.push(`${key}: "${value}" sent as "${match}" (schema enum)`);
      return match;
    }
  }
  return value;
}

/**
 * Fit documented argument names and shapes to a tool's live input schema: keys are matched
 * ignoring case, `_` and `-` (flow_id ↔ flowId); keys the schema does not declare are dropped;
 * objects become JSON strings when the schema wants a string (and back); enum spellings are
 * matched. Without a schema (or properties) the arguments pass through unchanged.
 */
export function shapeArgs(schema: JsonSchema | undefined, args: Record<string, unknown>): { args: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  const props = schema?.properties;
  const defined = Object.entries(args).filter(([, value]) => value !== undefined);
  if (!props || typeof props !== 'object' || Object.keys(props).length === 0) {
    return { args: Object.fromEntries(defined), notes };
  }
  const byNorm = new Map(Object.keys(props).map((key) => [normKey(key), key]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of defined) {
    const target = key in props ? key : byNorm.get(normKey(key));
    if (target === undefined) {
      notes.push(`${key}: dropped (not in the live schema)`);
      continue;
    }
    if (target !== key) notes.push(`${key}: sent as ${target}`);
    if (target in out) continue;
    out[target] = coerce(value, props[target], target, notes);
  }
  for (const required of schema?.required ?? []) {
    if (!(required in out)) notes.push(`${required}: required by the live schema but not sent`);
  }
  return { args: out, notes };
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

export interface LiveHspOptions {
  url: string;
  /** Timeout for connecting (MCP initialize), default 10 s. */
  connectTimeoutMs?: number;
  /** Default per-tool timeout, default 30 s. */
  callTimeoutMs?: number;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
  /** Where connection and schema logs go; default console.log. */
  log?: (line: string) => void;
}

const CLIENT_INFO = { name: 'nod-server', version: '0.2.0' };

const sessionLost = (error: unknown): boolean => {
  const status = httpStatusOf(error);
  if (status === 404 || status === 400) return true; // unknown or expired Mcp-Session-Id
  return error instanceof McpError && error.code === ErrorCode.ConnectionClosed;
};

export class LiveHspClient implements HspClient {
  readonly mode = 'live' as const;
  readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly log: (line: string) => void;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<Client> | null = null;
  private tools = new Map<string, HspToolInfo>();
  private toolsLogged = false;
  private readonly shapingLogged = new Set<string>();

  constructor(options: LiveHspOptions) {
    this.url = options.url;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetch;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Connect (once; concurrent callers share the attempt) and load the tool list. */
  async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async open(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      // Requests are short; do not keep retrying a background SSE stream forever.
      reconnectionOptions: { maxRetries: 1, initialReconnectionDelay: 1000, maxReconnectionDelay: 5000, reconnectionDelayGrowFactor: 2 },
    });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    client.onerror = () => {
      // Background stream errors surface on the next call; nothing to do here.
    };
    try {
      await client.connect(transport, { timeout: this.connectTimeoutMs });
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw toHspUnavailable(error, this.url) ?? error;
    }
    this.client = client;
    this.transport = transport;
    try {
      const { tools } = await client.listTools(undefined, { timeout: this.connectTimeoutMs });
      this.tools = new Map(
        tools.map((tool) => [tool.name, { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as JsonSchema }]),
      );
    } catch (error) {
      this.log(`[nod/hsp] could not list HSP tools (${error instanceof Error ? error.message : String(error)}); calling with documented arguments`);
    }
    this.logToolsOnce(client);
    return client;
  }

  private logToolsOnce(client: Client): void {
    if (this.toolsLogged) return;
    this.toolsLogged = true;
    const server = client.getServerVersion();
    const lines = [
      `[nod/hsp] connected to ${this.url}${server ? ` (${server.name} ${server.version})` : ''}, session ${this.transport?.sessionId ?? 'none'}`,
      `[nod/hsp] ${this.tools.size} live tools:`,
    ];
    for (const tool of this.tools.values()) {
      lines.push(`  - ${tool.name}${tool.description ? `: ${clip(tool.description, 160)}` : ''}`);
      lines.push(`    input: ${JSON.stringify(tool.inputSchema ?? {})}`);
    }
    const missing = HSP_TOOLS.filter((name) => this.tools.size > 0 && !this.tools.has(name));
    if (missing.length > 0) lines.push(`[nod/hsp] WARNING: documented tools missing from the live server: ${missing.join(', ')}`);
    this.log(lines.join('\n'));
  }

  async listTools(): Promise<HspToolInfo[]> {
    await this.connect();
    return [...this.tools.values()];
  }

  async callTool(name: string, args: Record<string, unknown>, options: HspCallOptions = {}): Promise<unknown> {
    const attempt = async (): Promise<unknown> => {
      const client = await this.connect();
      const { args: shaped, notes } = shapeArgs(this.tools.get(name)?.inputSchema, args);
      const noteKey = `${name}:${notes.join('|')}`;
      if (notes.length > 0 && !this.shapingLogged.has(noteKey)) {
        this.shapingLogged.add(noteKey);
        this.log(`[nod/hsp] ${name}: ${notes.join('; ')}`);
      }
      // request() rather than callTool(): skips client-side output-schema validation, so an
      // HSP result that does not match its declared schema still reaches our lenient parsers.
      return client.request(
        { method: 'tools/call', params: { name, arguments: shaped } },
        CompatibilityCallToolResultSchema,
        { timeout: options.timeoutMs ?? this.callTimeoutMs },
      );
    };
    try {
      return await attempt();
    } catch (error) {
      if (!sessionLost(error)) throw toHspUnavailable(error, this.url) ?? error;
      await this.reset();
      try {
        return await attempt();
      } catch (retryError) {
        throw toHspUnavailable(retryError, this.url) ?? retryError;
      }
    }
  }

  /** Drop the session; the next call reconnects. */
  async reset(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    await transport?.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    const transport = this.transport;
    await transport?.terminateSession().catch(() => undefined);
    await this.reset();
  }
}
