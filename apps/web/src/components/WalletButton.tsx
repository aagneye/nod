import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WizardConnectQRDialog } from '@wizardconnect/react';
import { useWallet } from '../wallet/context';
import { walletAddresses } from '../wallet/wizard';
import { shortAddress } from '../lib/address';
import { copyText } from '../lib/clipboard';
import { Spinner } from './ui';

/** QR edge in px: the library default (280) overflows the dialog on a 375px phone. */
const qrSizeForViewport = (): number => (typeof window !== 'undefined' && window.innerWidth < 420 ? 220 : 280);

/**
 * Pinned under the pairing dialog: on a phone the user cannot scan their own
 * screen, so offer the pairing URI as a deep link (wiz://…) plus a copy button.
 */
function PairOnThisDevice({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copyText(uri)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm items-center gap-2 border-2 border-ink bg-bg p-2 shadow-[6px_6px_0_rgba(23,23,19,0.35)]">
        <a href={uri} className="btn-solid flex-1 text-center">
          Open in wallet ↗
        </a>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="border border-line px-3 py-2.5 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:border-strong"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Connect / show / disconnect the judge's wallet over WizardConnect. */
export function WalletButton() {
  const { state, manager, uri, qrUri, walletName, connect, disconnect, error } = useWallet();
  const [showQr, setShowQr] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (state === 'connected' && manager) {
      setShowQr(false);
      try {
        setAddress(walletAddresses(manager).receive);
      } catch {
        setAddress(null);
      }
    } else if (state !== 'connecting' && state !== 'reconnecting') {
      setAddress(null);
    }
  }, [state, manager]);

  const startConnect = () => {
    const started = connect();
    if (started || uri) setShowQr(true);
  };

  if (state === 'connected') {
    return (
      <div className="flex items-center gap-2">
        <span className="chip hidden md:inline-flex">
          <span className="inline-block size-1.5 rounded-full bg-current" />
          {walletName ?? 'wallet'}
          {address ? ` · ${shortAddress(address, 6)}` : ''}
        </span>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="border border-line px-3 py-2 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:border-strong"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const busy = state === 'connecting' || state === 'reconnecting';
  const dialogOpen = showQr && !!uri && !!qrUri;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={busy && uri ? () => setShowQr(true) : startConnect}
        disabled={busy && !uri}
        className="btn-solid"
      >
        {busy && !uri ? (
          <>
            <Spinner className="size-3 border-ink/30 border-t-[#f4f3ea]" />
            Connecting…
          </>
        ) : busy ? (
          'Show QR'
        ) : (
          <>
            Connect<span className="hidden sm:inline">&nbsp;wallet</span>
          </>
        )}
      </button>
      {error ? <span className="hidden max-w-40 truncate text-xs text-danger lg:inline">{error}</span> : null}
      {dialogOpen ? (
        <>
          <WizardConnectQRDialog
            show
            onClose={() => setShowQr(false)}
            uri={uri}
            qrUri={qrUri}
            onCopy={(text) => void copyText(text)}
            subtitle="Scan with Paytaca or Cashonize, or open the link below on this phone"
            theme={{ qrSize: qrSizeForViewport() }}
          />
          <PairOnThisDevice uri={uri} />
        </>
      ) : null}
    </div>
  );
}
