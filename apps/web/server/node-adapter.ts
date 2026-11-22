/**
 * Adapt a web-standard `(Request) => Promise<Response>` handler to Node's `(req, res)`.
 * Used by the Vite dev middleware, the Vercel functions and the standalone server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import type { Handler } from './http.js';

const MAX_BODY_BYTES = 256 * 1024;

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError(`Body larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(buf);
  }
  const all = Buffer.concat(chunks);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || undefined;

export function toNodeHandler(handler: Handler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
      const encrypted = Boolean((req.socket as TLSSocket | undefined)?.encrypted);
      const proto = first(req.headers['x-forwarded-proto']) ?? (encrypted ? 'https' : 'http');
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
      }
      const body = await readBody(req);
      const request = new Request(new URL(req.url ?? '/', `${proto}://${host}`), {
        method: req.method ?? 'GET',
        headers,
        ...(body ? { body } : {}),
      });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.statusCode = e instanceof BodyTooLargeError ? 413 : 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: e instanceof BodyTooLargeError ? 'bad_request' : 'internal' }));
    }
  };
}
