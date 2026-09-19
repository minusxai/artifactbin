import { useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { artifactAppPath } from '@/lib/artifact-pwa';
import { consumeInstall, currentInstall, subscribeInstall } from '@/lib/pwa-install';
import ConfirmDialog from './ConfirmDialog';

/** Full document navigation makes browser install discovery unambiguous. */
export function InstallArtifactLink({ id, className }: { id: string; className?: string }) {
  if (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return null;
  return <a href={`${artifactAppPath(id)}?install=1`} className={className} aria-label="Install app"><Download size={14} strokeWidth={1.75} />Install app</a>;
}

export function InstallArtifact({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(() => window.location.pathname === artifactAppPath(id) && new URLSearchParams(window.location.search).has('install'));
  const [error, setError] = useState(false);
  const pending = useSyncExternalStore(subscribeInstall, currentInstall, () => null);
  const ready = pending?.path === artifactAppPath(id);
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('install');
    window.history.replaceState(window.history.state, '', url);
  };
  if (!open) return null;
  return <ConfirmDialog title={`Install ${title}`} action={ready ? 'Install app' : 'Done'} onCancel={close} onConfirm={() => {
    if (!ready) { close(); return; }
    const event = consumeInstall();
    void event?.prompt().then(close, () => setError(true));
  }} description={<>
    <p>Open this artifact from your home screen or desktop. An internet connection is required.</p>
    {!ready && <p className="mt-3">On iPhone or iPad, open the Share menu and choose Add to Home Screen. In Chrome or Edge, use the browser menu’s Install app option. In Safari on Mac, choose File → Add to Dock.</p>}
    {error && <p role="alert" className="mt-3">The install prompt could not open. Use your browser’s install option.</p>}
  </>} />;
}
