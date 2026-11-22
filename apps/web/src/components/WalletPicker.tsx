import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { WALLET_INSTALL_LINKS } from '../config';
import { useWallet } from '../wallet/context';
import { INJECTED_RDNS, type WalletOption } from '../wallet/eip6963';
import { FriendlyErrorNote, Spinner } from './ui';

function WalletIcon({ option }: { option: WalletOption }) {
  if (option.info.icon) {
    return <img src={option.info.icon} alt="" className="size-8 shrink-0 rounded-md" draggable={false} />;
  }
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-soft font-display text-base italic">
      {option.info.name.slice(0, 1)}
    </span>
  );
}

/**
 * The wallet picker: every wallet the browser announced (EIP-6963), or install links when none did.
 * Opened from the header button or by the payment page when it needs a wallet.
 */
export function WalletPicker() {
  const { wallets, pickerOpen, pickerError, connectingTo, connect, closePicker } = useWallet();
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    firstButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  const busy = connectingTo !== null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#0f0f0e]/45 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) closePicker();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title" className="card w-full max-w-sm p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="eyebrow">Wallet</span>
            <h2 id="wallet-picker-title" className="display mt-3 text-3xl">
              Connect a wallet
            </h2>
          </div>
          <button
            type="button"
            onClick={closePicker}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center border border-line text-sm transition hover:border-strong"
          >
            ✕
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Nod asks your wallet for its address, then for one signature per payment. It never sees your keys.
        </p>

        {wallets.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {wallets.map((option, i) => {
              const connecting = connectingTo?.info.uuid === option.info.uuid;
              return (
                <li key={option.info.uuid}>
                  <button
                    ref={i === 0 ? firstButton : undefined}
                    type="button"
                    disabled={busy}
                    onClick={() => void connect(option).catch(() => undefined)}
                    className="flex w-full items-center gap-3 border-[1.5px] border-ink bg-bg px-3 py-2.5 text-left transition hover:bg-acid hover:text-[#171713] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <WalletIcon option={option} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">{option.info.name}</b>
                      <small className="block truncate text-[10px] tracking-[0.08em] text-faint">
                        {option.info.rdns === INJECTED_RDNS ? 'Injected provider' : option.info.rdns}
                      </small>
                    </span>
                    {connecting ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <span aria-hidden="true" className="text-accent">
                        →
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-5 border border-line bg-soft p-4 text-sm">
            <p className="font-semibold text-ink">No wallet found in this browser.</p>
            <p className="mt-1.5 text-muted">Install one, then reload this page.</p>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {WALLET_INSTALL_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
                >
                  {link.label} ↗
                </a>
              ))}
            </p>
          </div>
        )}

        {connectingTo ? (
          <p className="mt-4 text-xs text-muted">Approve the connection in {connectingTo.info.name}…</p>
        ) : null}
        {pickerError ? (
          <div className="mt-4">
            <FriendlyErrorNote error={pickerError} />
          </div>
        ) : null}

        <p className="mt-5 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">
          Detected with EIP-6963 · OKX Wallet, MetaMask and others
        </p>
      </div>
    </div>,
    document.body,
  );
}
