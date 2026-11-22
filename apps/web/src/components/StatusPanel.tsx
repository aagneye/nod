import type { ReactNode } from 'react';
import { addressUrl, chainName } from '../lib/chains';
import { formatUsd } from '../lib/format';
import { refreshConfig, useNodConfig } from '../lib/nodConfig';
import { AddressValue, Badge, ErrorNote, NetworkBadge, Row, Spinner } from './ui';

function NotDeployed({ children = 'Not deployed yet' }: { children?: ReactNode }) {
  return <span className="text-[11px] font-bold tracking-[0.14em] text-warn uppercase">{children}</span>;
}

/**
 * What this deployment is wired to, read live from GET /api/config: HSP mode and reachability,
 * the network and token HSP pays in, and Nod's contracts on HSK Chain.
 */
export function StatusPanel() {
  const { config, error, loading, fetchedAt } = useNodConfig();

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span className="eyebrow">Live status</span>
        <h3 className="display mt-4 text-3xl">This deployment, right now.</h3>
      </div>
      <button
        type="button"
        onClick={() => void refreshConfig()}
        disabled={loading}
        className="flex items-center gap-2 border border-line px-3 py-2 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:border-strong disabled:opacity-60"
      >
        {loading ? <Spinner className="size-3" /> : null}
        Refresh
      </button>
    </div>
  );

  if (!config) {
    return (
      <div className="card p-5 sm:p-7">
        {header}
        {error ? (
          <div className="mt-6 space-y-3">
            <ErrorNote>The Nod API did not answer: {error}</ErrorNote>
            <p className="text-sm text-muted">
              Payments need the API (it talks to HSP and HSK Chain). Check that the server is running and that this app
              points at it.
            </p>
          </div>
        ) : (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Spinner /> Reading /api/config…
          </p>
        )}
      </div>
    );
  }

  const { hsp, receipts, policy } = config;
  const option = hsp.option;

  return (
    <div className="card p-5 sm:p-7">
      {header}
      <dl className="mt-6">
        <Row label="HSP">
          <span className="inline-flex flex-wrap justify-end gap-2">
            {hsp.mode === 'mock' ? (
              <Badge tone="warn" dot>
                Simulation
              </Badge>
            ) : (
              <Badge tone="ok" dot>
                Live
              </Badge>
            )}
            {hsp.reachable ? (
              <Badge tone="ok">Reachable</Badge>
            ) : (
              <Badge tone="bad">Unreachable</Badge>
            )}
          </span>
          {!hsp.reachable && hsp.error ? (
            <span className="mt-1.5 block font-mono text-[11px] break-words text-danger">{hsp.error}</span>
          ) : null}
        </Row>
        <Row label="Merchant">
          <span className="text-ink">{hsp.merchantName || '—'}</span>
        </Row>
        <Row label="Pays on">
          {option ? (
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <span className="text-ink">{option.network}</span>
              <NetworkBadge chainId={option.chainId} />
            </span>
          ) : (
            <span className="text-muted">Not known until HSP answers</span>
          )}
        </Row>
        <Row label="Token">
          {option ? (
            <span className="block">
              <span className="text-ink">
                {option.coin} <span className="text-faint">· {option.decimals} decimals · {option.paymentProtocol}</span>
              </span>
              <span className="mt-1 block">
                <AddressValue
                  address={option.contractAddress}
                  href={addressUrl(option.chainId, option.contractAddress)}
                />
              </span>
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Row>
        <Row label="NodReceipts">
          {receipts.address ? (
            <span className="block">
              <AddressValue
                address={receipts.address}
                href={addressUrl(receipts.chainId, receipts.address, receipts.explorer)}
              />
              <span className="mt-1 block text-[11px] text-faint">on {chainName(receipts.chainId)}</span>
            </span>
          ) : (
            <NotDeployed />
          )}
        </Row>
        <Row label="Recorder">
          {receipts.recorder ? (
            <AddressValue
              address={receipts.recorder}
              href={addressUrl(receipts.chainId, receipts.recorder, receipts.explorer)}
            />
          ) : (
            <NotDeployed>Not configured</NotDeployed>
          )}
        </Row>
        <Row label="NodPolicy">
          {policy.address ? (
            <span className="block">
              <AddressValue address={policy.address} href={addressUrl(policy.chainId, policy.address)} />
              <span className="mt-1 block text-[11px] text-faint">on {chainName(policy.chainId)}</span>
            </span>
          ) : (
            <NotDeployed />
          )}
        </Row>
        <Row label="Demo price">
          <span className="text-ink">{formatUsd(config.demoUsd)} USD</span>
        </Row>
      </dl>
      <p className="mt-4 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">
        Read from /api/config{fetchedAt ? ` at ${new Date(fetchedAt).toLocaleTimeString()}` : ''}
      </p>
    </div>
  );
}
