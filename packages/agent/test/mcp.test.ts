import { decodeLink } from '@nod/protocol';
import { describe, expect, it } from 'vitest';
import { handleMessage } from '../src/mcp.js';
import { FakeChain, VENDOR, tempEnv } from './helpers.js';

type Res = { id: unknown; result?: any; error?: { code: number; message: string } };

describe('MCP server', () => {
  it('initialize → tools/list → tools/call nod_request_payment → status → list', async () => {
    const env = tempEnv();
    const ctx = { env, status: { chain: new FakeChain() } };

    const init = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      ctx,
    )) as Res;
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.serverInfo.name).toBe('nod');

    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();

    const list = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)) as Res;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'nod_request_payment',
      'nod_payment_status',
      'nod_list_requests',
    ]);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');

    const call = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nod_request_payment', arguments: { vendor: VENDOR, sats: 1000, purpose: '1 weather API call', expires_in: '30m' } },
      },
      ctx,
    )) as Res;
    expect(call.result.isError).toBeUndefined();
    const text: string = call.result.content[0].text;
    const link = /https:\/\/nod\.example\/r#[A-Za-z0-9_-]+/.exec(text)![0];
    const d = decodeLink(link.slice(link.indexOf('#') + 1));
    expect(d.valid).toBe(true);
    expect(d.expired).toBe(false);
    expect(d.signed.req.purpose).toBe('1 weather API call');

    const status = (await handleMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nod_payment_status', arguments: { id: d.signed.req.id } } },
      ctx,
    )) as Res;
    expect(status.result.content[0].text).toMatch(/^UNPAID/);

    const listed = (await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nod_list_requests', arguments: {} } },
      ctx,
    )) as Res;
    expect(listed.result.content[0].text).toContain(d.signed.req.id);
  });

  it('reports tool errors as isError results and unknown methods as JSON-RPC errors', async () => {
    const ctx = { env: tempEnv() };
    const bad = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nod_request_payment', arguments: { vendor: 'nope', sats: 1000, purpose: 'x' } } },
      ctx,
    )) as Res;
    expect(bad.result.isError).toBe(true);
    const unknownTool = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zzz' } }, ctx)) as Res;
    expect(unknownTool.error?.code).toBe(-32602);
    const unknown = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, ctx)) as Res;
    expect(unknown.error?.code).toBe(-32601);
    expect(await handleMessage({ jsonrpc: '2.0', id: 4, method: 'ping' }, ctx)).toEqual({ jsonrpc: '2.0', id: 4, result: {} });
  });
});
