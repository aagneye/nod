import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Banner } from './components/Banner';
import { Card, Spinner } from './components/ui';
import { WalletPicker } from './components/WalletPicker';
import { REPO_URL, REQUISITION_URL } from './config';
import { WalletProvider } from './wallet/context';
import Home from './pages/Home';

// Home stays in the entry chunk; every other route loads on demand.
const RequestPage = lazy(() => import('./pages/Request'));
const ReceiptPage = lazy(() => import('./pages/Receipt'));
const HowPage = lazy(() => import('./pages/How'));

/** A new route starts at the top of the page (BrowserRouter keeps the old scroll position). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner className="size-6" />
    </div>
  );
}

/** A failed lazy chunk (e.g. a stale tab after a redeploy) must not blank the app. */
class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card>
        <h1 className="display text-2xl">This page could not load</h1>
        <p className="mt-3 text-sm text-muted">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 border border-line px-3 py-2 text-[10px] font-bold tracking-[0.14em] uppercase transition hover:border-strong"
        >
          Reload
        </button>
      </Card>
    );
  }
}

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

const footerLink =
  'tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline';

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <WalletProvider>
        <div className="flex min-h-dvh flex-col">
          <Banner />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            <PageErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/r" element={<RequestPage />} />
                  <Route path="/receipt" element={<ReceiptPage />} />
                  <Route path="/receipt/:flowId" element={<ReceiptPage />} />
                  <Route path="/how" element={<HowPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </PageErrorBoundary>
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-[11px]">
              <span className="tracking-[0.16em] text-faint uppercase">Nod — agent payments on HSK Chain</span>
              <span className="flex items-center gap-5">
                <a href={REQUISITION_URL} target="_blank" rel="noreferrer" className={footerLink}>
                  Inspired by Requisition ↗
                </a>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className={footerLink}>
                  Source ↗
                </a>
              </span>
            </div>
          </footer>
        </div>
        <WalletPicker />
      </WalletProvider>
    </BrowserRouter>
  );
}
