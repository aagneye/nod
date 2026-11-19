import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Banner } from './components/Banner';
import { Card } from './components/ui';
import { REPO_URL } from './config';
import { WalletProvider } from './wallet/context';
import Home from './pages/Home';
import RequestPage from './pages/Request';
import ReceiptPage from './pages/Receipt';
import BatchPage from './pages/Batch';

function NotFound() {
  return (
    <Card>
      <h1 className="display text-2xl">Page not found</h1>
      <p className="mt-3 text-sm text-muted">
        <Link to="/" className="tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline">
          ← Back to Nod
        </Link>
      </p>
    </Card>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <div className="flex min-h-dvh flex-col">
          <Banner />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/r" element={<RequestPage />} />
              <Route path="/batch" element={<BatchPage />} />
              <Route path="/tx/:txid" element={<ReceiptPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-[11px]">
              <span className="tracking-[0.16em] text-faint uppercase">
                Nod — built for BCH BLAZE 2026 on Bitcoin Cash
              </span>
              <span className="flex items-center gap-5">
                <a
                  href="https://dorahacks.io/build/50833"
                  target="_blank"
                  rel="noreferrer"
                  className="tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
                >
                  Inspired by Requisition ↗
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
                >
                  Source ↗
                </a>
              </span>
            </div>
          </footer>
        </div>
      </WalletProvider>
    </BrowserRouter>
  );
}
