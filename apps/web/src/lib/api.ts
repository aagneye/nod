import { API_BASE } from '../config';

/**
 * Ask the demo agent (Person C's `api/demo-agent.ts`) for a signed request link.
 * Accepts either `{ link }` JSON or a plain-text URL, so the app does not care
 * which shape the endpoint returns.
 */
export async function fetchDemoLink(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/demo-agent`, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Could not reach the demo agent endpoint.');
  }
  if (!res.ok) throw new Error(`Demo agent responded ${res.status}.`);
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const data: unknown = await res.json();
    const link =
      typeof data === 'object' && data !== null
        ? ((data as { link?: unknown; url?: unknown }).link ?? (data as { url?: unknown }).url)
        : undefined;
    if (typeof link !== 'string') throw new Error('Demo agent did not return a link.');
    return link;
  }
  const text = (await res.text()).trim();
  if (!/^https?:\/\//.test(text)) throw new Error('Demo agent did not return a link.');
  return text;
}
