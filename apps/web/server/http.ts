/** HTTP helpers shared by the API handlers: JSON responses, errors and body parsing. */
import { getAddress, isAddress, type Address } from 'viem';

/** Web-standard handler signature used by every runtime (Vite dev, Vercel, standalone). */
export type Handler = (request: Request) => Promise<Response>;

/** An error that maps to a JSON response `{ error, code?, ...extra }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** JSON.stringify that writes bigints as decimal strings. */
export const toJson = (body: unknown): string =>
  JSON.stringify(body, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(toJson(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const errorJson = (status: number, error: string, code?: string, extra: Record<string, unknown> = {}): Response =>
  json(status, { error, ...(code ? { code } : {}), ...extra });

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);

export type JsonObject = Record<string, unknown>;

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The request body as a JSON object; 400 otherwise. */
export async function readJsonBody(request: Request): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON', 'bad_request');
  }
  if (!isJsonObject(body)) throw new HttpError(400, 'Body must be a JSON object', 'bad_request');
  return body;
}

export function requireString(value: unknown, name: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${name} is required`, 'bad_request');
  if (value.length > maxLength) throw new HttpError(400, `${name} is too long`, 'bad_request');
  return value.trim();
}

export function optionalString(value: unknown, name: string, maxLength = 512): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, name, maxLength);
}

/** Any 0x address (lowercase or checksummed), returned checksummed; 400 otherwise. */
export function requireAddress(value: unknown, name: string): Address {
  if (typeof value !== 'string' || !isAddress(value.trim(), { strict: false })) {
    throw new HttpError(400, `${name} must be an 0x address`, 'bad_request');
  }
  return getAddress(value.trim());
}
