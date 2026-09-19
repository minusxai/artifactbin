/** Capture before React's lazy reader loads. A prompt belongs to one document
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
export function captureInstallPrompt(target: Window): () => void {
  const capture = (event: Event) => {
    if (!/^\/a\/[a-zA-Z0-9]{6,12}\/app\/$/.test(target.location.pathname)) return;
    event.preventDefault();
    pending = { path: target.location.pathname, event: event as InstallPrompt };
    emit();
  };
  const clear = () => { pending = null; emit(); };
  target.addEventListener('beforeinstallprompt', capture);
  target.addEventListener('appinstalled', clear);
  return () => { target.removeEventListener('beforeinstallprompt', capture); target.removeEventListener('appinstalled', clear); clear(); };
}
