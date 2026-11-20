/** Helpers shared by the API handlers. */

/** Web-standard handler signature used by every endpoint. */
export type Handler = (request: Request) => Promise<Response>;

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
