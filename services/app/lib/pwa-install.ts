/** Capture before the lazy reader loads. A prompt belongs to one document
 * path and must never be reused after SPA navigation to a different artifact. */
export interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let pending: { path: string; event: InstallPrompt } | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export const subscribeInstall = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const currentInstall = () => pending;
export function consumeInstall(): InstallPrompt | null {
  const event = pending?.event ?? null;
  pending = null;
  emit();
  return event;
}
const capturing = new WeakSet<Window>();
export function captureInstallPrompt(target: Window): () => void {
  if (capturing.has(target)) return () => {};
  capturing.add(target);
  const capture = (event: Event) => {
    const href = target.document.querySelector<HTMLLinkElement>('link[data-mx-pwa][rel="manifest"]')?.href;
    const manifest = href ? new URL(href, target.location.href) : null;
    const path = manifest?.origin === target.location.origin ? manifest.pathname.replace(/manifest\.webmanifest$/, '') : target.location.pathname;
    if (!/^\/a\/[a-zA-Z0-9]{6,12}\/app\/$/.test(path)) return;
    // Explicit install flow owns its prompt. Ordinary readers retain the browser's promotion.
    if (new URLSearchParams(target.location.search).has('install')) event.preventDefault();
    pending = { path, event: event as InstallPrompt };
    emit();
  };
  const clear = () => { pending = null; emit(); };
  target.addEventListener('beforeinstallprompt', capture);
  target.addEventListener('appinstalled', clear);
  return () => { capturing.delete(target); target.removeEventListener('beforeinstallprompt', capture); target.removeEventListener('appinstalled', clear); clear(); };
}
