import { useEffect, useState } from 'react';
import { WizardConnectQRDialog } from '@wizardconnect/react';
import { useWallet } from '../wallet/context';
import { walletAddresses } from '../wallet/wizard';
import { shortAddress } from '../lib/address';
import { Spinner } from './ui';

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

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={startConnect} disabled={busy} className="btn-solid">
        {busy ? (
          <>
            <Spinner className="size-3 border-ink/30 border-t-[#f4f3ea]" />
            Connecting…
          </>
        ) : (
          'Connect wallet'
        )}
      </button>
      {error ? <span className="hidden max-w-40 truncate text-xs text-danger lg:inline">{error}</span> : null}
      {showQr && uri && qrUri ? (
        <WizardConnectQRDialog show onClose={() => setShowQr(false)} uri={uri} qrUri={qrUri} />
      ) : null}
    </div>
  );
}
