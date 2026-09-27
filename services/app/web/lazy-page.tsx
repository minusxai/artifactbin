import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import { ShellFrame } from './Shell';

class ChunkBoundary extends Component<{ children: ReactNode; retry: () => void; framed: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const error = <main className="mx-auto max-w-5xl px-4 py-10" role="alert">Could not load this page. <button aria-label="Retry loading page" onClick={this.props.retry}>Retry</button> <button aria-label="Reload app" onClick={() => window.location.reload()}>Reload app</button></main>;
    return this.props.framed ? <ShellFrame pending>{error}</ShellFrame> : error;
  }
}

function PendingPage() {
  return <main aria-label="Loading page" role="status" aria-busy="true" className="mx-auto max-w-5xl px-4 py-10"><span className="sr-only">Loading page…</span><div aria-hidden="true" className="h-7 w-48 rounded bg-raised" /></main>;
}

/**
 * Route-code boundary. A failed download is retried only on an explicit gesture.
 *
 * Code that has already ARRIVED (a preload, the entry awaiting a document's
 * reader) renders on the page's first commit: a lazy() that has not been read
 * suspends even on a settled download, and React holds a revealed fallback for
 * its throttle (300 ms) — twice on a document, measured. The choice is made
 * once per mounted page, so a page never switches element type under itself.
 */
type LazyPage<P extends object> = ComponentType<P> & { preload(): Promise<void> };
export function lazyPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, framed = false): LazyPage<P> {
  let pending: ReturnType<typeof load> | undefined;
  let arrived: ComponentType<P> | undefined;
  const module = () => pending ??= load().then(m => { arrived = m.default; return m; });
  let Current = lazy(module);
  const Page = function LazyPage(props: P) {
    const [attempt, setAttempt] = useState(0);
    const [Arrived] = useState(() => arrived);
    const retry = () => { pending = undefined; Current = lazy(module); setAttempt(value => value + 1); };
    // Only pending/error UI needs a temporary frame. Resolved artifact/profile
    // modules own their chrome; app routes already sit inside the stable Shell.
    const fallback = framed ? <ShellFrame pending><PendingPage /></ShellFrame> : <PendingPage />;
    return <ChunkBoundary key={attempt} retry={retry} framed={framed}><Suspense fallback={fallback}>{Arrived ? <Arrived {...props} /> : <Current {...props} />}</Suspense></ChunkBoundary>;
  };
  return Object.assign(Page, { preload: async () => { await module(); } });
}
