import { useEffect, useRef, useState } from 'react';
import { addressUrl, chainLabel, chainName } from '../lib/chains';
import { friendlyError, type FriendlyError } from '../lib/errors';
import { shortAddress } from '../lib/format';
import { paymentChainId, useNodConfig } from '../lib/nodConfig';
import { useWallet } from '../wallet/context';
import { CopyButton, ExplorerLink, FriendlyErrorNote, Spinner } from './ui';

/** Header wallet control: connect through the picker, then address + network with a small menu. */
export function WalletButton() {
  const wallet = useWallet();
  const { config } = useNodConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (wallet.status !== 'connected') setMenuOpen(false);
  }, [wallet.status]);

  if (wallet.status !== 'connected' || !wallet.address) {
    const busy = wallet.status === 'connecting';
    return (
      <button type="button" onClick={wallet.openPicker} disabled={busy} className="btn-solid">
        {busy ? (
          <>
            <Spinner className="size-3 border-[#f4f3ea]/30 border-t-[#f4f3ea]" />
            Connecting…
          </>
        ) : (
          <>
            Connect<span className="hidden sm:inline">&nbsp;wallet</span>
          </>
        )}
      </button>
    );
  }

  const target = paymentChainId(config);
  const onTarget = target === undefined || wallet.chainId === target;

  const onSwitch = async () => {
    if (target === undefined) return;
    setSwitching(true);
    setError(null);
    try {
      await wallet.switchChain(target);
    } catch (e) {
      setError(friendlyError(e, 'switch'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2 border-2 border-ink bg-panel px-2.5 py-1.5 text-[11px] font-bold tracking-[0.06em] whitespace-nowrap transition hover:bg-acid hover:text-[#171713]"
      >
        {wallet.wallet?.info.icon ? (
          <img src={wallet.wallet.info.icon} alt="" className="size-4 rounded-sm" draggable={false} />
        ) : (
          <span className="inline-block size-1.5 rounded-full bg-[#2f9e44]" />
        )}
        <code className="text-[11px]">{shortAddress(wallet.address)}</code>
        <span
          className={`hidden text-[9px] tracking-[0.14em] uppercase sm:inline ${onTarget ? 'text-muted' : 'text-danger'}`}
        >
          {chainLabel(wallet.chainId)}
        </span>
        <span aria-hidden="true" className="text-[9px]">
          ▾
        </span>
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="card absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] p-4 text-sm"
        >
          <p className="label">{wallet.wallet?.info.name ?? 'Wallet'}</p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all text-[11px] leading-relaxed text-ink">{wallet.address}</code>
            <CopyButton text={wallet.address} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-xs text-muted">
              Network: <b className="text-ink">{chainName(wallet.chainId)}</b>
              {wallet.chainId ? ` (${wallet.chainId})` : ''}
            </span>
            <ExplorerLink href={addressUrl(wallet.chainId, wallet.address)} />
          </div>
          {!onTarget && target !== undefined ? (
            <div className="mt-3">
              <p className="text-xs text-muted">HSP pays on {chainName(target)}.</p>
              <button
                type="button"
                onClick={() => void onSwitch()}
                disabled={switching}
                className="mt-2 w-full border-[1.5px] border-ink px-3 py-2 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:bg-acid hover:text-[#171713] disabled:opacity-60"
              >
                {switching ? 'Check your wallet…' : `Switch to ${chainLabel(target)}`}
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="mt-3">
              <FriendlyErrorNote error={error} />
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                wallet.openPicker();
              }}
              className="text-[10px] font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
            >
              Change wallet
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                wallet.disconnect();
              }}
              className="border border-line px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:border-strong"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
