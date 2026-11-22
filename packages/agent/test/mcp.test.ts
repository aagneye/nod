import { decodeLink, verifyTerms } from '@nod/protocol';
import { describe, expect, it } from 'vitest';
import { handleMessage } from '../src/mcp.js';
import { PAY_TO, fakeReceiptServer, tempEnv } from './helpers.js';

type Res = { id: unknown; result?: any; error?: { code: number; message: string } };

describe('MCP server', () => {
  it('initialize → tools/list → nod_request_payment → nod_payment_status → nod_list_requests', async () => {
    const env = tempEnv();
    const server = fakeReceiptServer();
    const ctx = { env, status: { fetch: server.fetch } };

    const init = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      ctx,
    )) as Res;
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.serverInfo.name).toBe('nod');
    expect(init.result.instructions).toMatch(/HSK Chain/);

    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();

    const list = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)) as Res;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['nod_request_payment', 'nod_payment_status', 'nod_list_requests']);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');
    expect(list.result.tools[0].inputSchema.required).toEqual(['payTo', 'amountUsd', 'purpose']);
    expect(list.result.tools[0].description).toMatch(/HSP/);

    const call = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nod_request_payment', arguments: { payTo: PAY_TO, amountUsd: '0.10', purpose: '1 weather API call', merchant: 'Weather bot' } },
      },
      ctx,
    )) as Res;
    expect(call.result.isError).toBeUndefined();
    const text: string = call.result.content[0].text;
    const link = /https:\/\/nod\.example\/r#[A-Za-z0-9_-]+/.exec(text)![0];
    const signed = decodeLink(link);
    expect((await verifyTerms(signed)).valid).toBe(true);
    expect(signed.terms).toMatchObject({ purpose: '1 weather API call', merchant: 'Weather bot', amountUsd: '0.10', payTo: PAY_TO });
    const details = JSON.parse(text.slice(text.indexOf('{')));

    const status = (await handleMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nod_payment_status', arguments: { termsHash: details.termsHash } } },
      ctx,
    )) as Res;
    expect(status.result.content[0].text).toMatch(/^UNPAID/);
    expect(server.urls[0]).toBe(`https://nod.example/api/receipt?termsHash=${details.termsHash}`);

    const paid = (await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nod_payment_status', arguments: { id: details.id } } },
      { env, status: { fetch: fakeReceiptServer({ paid: [details.termsHash] }).fetch } },
    )) as Res;
    expect(paid.result.content[0].text).toMatch(/^PAID: https:\/\/sepolia\.etherscan\.io\/tx\//);

    const listed = (await handleMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nod_list_requests', arguments: {} } },
      ctx,
    )) as Res;
    expect(listed.result.content[0].text).toContain(details.termsHash);
  });

  it('reports tool errors as isError results and unknown methods as JSON-RPC errors', async () => {
    const ctx = { env: tempEnv() };
    const bad = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nod_request_payment', arguments: { payTo: 'nope', amountUsd: '1', purpose: 'x' } } },
      ctx,
    )) as Res;
    expect(bad.result.isError).toBe(true);
    const noTarget = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nod_payment_status', arguments: {} } }, ctx)) as Res;
    expect(noTarget.result.isError).toBe(true);
    const unknownTool = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zzz' } }, ctx)) as Res;
    expect(unknownTool.error?.code).toBe(-32602);
    const unknown = (await handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, ctx)) as Res;
    expect(unknown.error?.code).toBe(-32601);
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, method: 'ping' }, ctx)).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  });
});
