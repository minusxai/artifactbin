/* @jsxImportSource solid-js */
import { createSignal, onCleanup, Show } from 'solid-js';
import Download from 'lucide-solid/icons/download';
import { artifactAppPath } from '@/lib/serving/artifact-pwa';
import { consumeInstall, currentInstall, subscribeInstall } from '@/lib/serving/pwa-install';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/** Native discovery needs a full document navigation, not a client route transition. */
export function InstallArtifactLink(props: { id: string; class?: string; beforeNavigate?: () => Promise<boolean> }) {
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  return <Show when={!installed}><a href={`${artifactAppPath(props.id)}?install=1`} target="_self" aria-label="Install app" onClick={event => {
    if (!props.beforeNavigate) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    void props.beforeNavigate().then(ok => { if (ok) window.location.assign(href); });
  }} class={props.class}><Download size={14} />Install app</a></Show>;
}

export function InstallArtifact(props: { id: string; title: string }) {
  const [open, setOpen] = createSignal(window.location.pathname === artifactAppPath(props.id) && new URLSearchParams(window.location.search).has('install'));
  const [pending, setPending] = createSignal(currentInstall());
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  onCleanup(subscribeInstall(() => setPending(currentInstall())));
  const ready = () => pending()?.path === artifactAppPath(props.id);
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('install');
    window.history.replaceState(window.history.state, '', url);
  };
  const install = () => {
    if (!ready()) { close(); return; }
    const event = consumeInstall();
    if (!event) return;
    setBusy(true);
    // Calling prompt stays synchronous with the user's gesture.
    try { void event.prompt().then(close, () => setError('The install prompt could not open. Use your browser’s install option.')).finally(() => setBusy(false)); }
    catch { setBusy(false); setError('The install prompt could not open. Use your browser’s install option.'); }
  };
  return <Show when={open()}><ConfirmDialog title={`Install ${props.title}`} action={ready() ? 'Install app' : 'Done'} busy={busy()} error={error()} onCancel={close} onConfirm={install} description={<>
    <p>Open this artifact from your home screen or desktop. An internet connection is required.</p>
    <Show when={!ready()}><p class="mt-3">On iPhone or iPad, open the Share menu and choose Add to Home Screen. In Chrome or Edge, use the browser menu’s Install app option. In Safari on Mac, choose File → Add to Dock.</p></Show>
  </>} /></Show>;
}
