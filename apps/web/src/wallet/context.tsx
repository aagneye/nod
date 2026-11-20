import { createContext, useContext, type ReactNode } from 'react';
import { useWizardConnect, type UseWizardConnectResult } from '@wizardconnect/react';

const WalletContext = createContext<UseWizardConnectResult | null>(null);

/**
 * One WizardConnect session for the whole app (the banner's WalletButton and
 * the approval page share the same manager). Auto-reconnects from the stored
 * session on refresh (persistSession defaults to true).
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWizardConnect({ dappName: 'Nod' });
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWallet(): UseWizardConnectResult {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
