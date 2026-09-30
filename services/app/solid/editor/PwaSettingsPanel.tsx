/* @jsxImportSource solid-js */
import { createMemo, createSignal, Show } from 'solid-js';
import type { ImageChoice } from '@/lib/artifact-backend/types';
import { artifactAppPath } from '@/lib/artifact-pwa';
import { readPwaSettings, writePwaSettings, type PwaSettings } from '@/lib/story/pwa-settings';
import { InstallArtifactLink } from '../document/InstallArtifact';

export interface PwaSettingsPanelProps { id: string; title: string; source: string; onChange: (source: string) => void; onUpload: (file: File) => Promise<ImageChoice> }
const INPUT = 'mt-1 w-full rounded-md border border-edge bg-ground px-3 py-2 text-sm text-fg';

/** Uses the editor's source queue: settings participate in autosave, conflicts and undo. */
export function PwaSettingsPanel(props: PwaSettingsPanelProps) {
  const settings = createMemo(() => readPwaSettings(props.source));
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [uploaded, setUploaded] = createSignal<{ id: string; url: string } | null>(null);
  const update = (patch: Partial<PwaSettings>) => {
    try { props.onChange(writePwaSettings(props.source, { ...settings(), ...patch })); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update PWA settings.'); }
  };
  const upload = async (file: File) => {
    setUploading(true); setError('');
    try {
      const result = await props.onUpload(file);
      if (!result.ok) { setError(result.error); return; }
      setUploaded({ id: result.image.id, url: result.image.rawUrl ?? `/a/${result.image.id}/raw` });
      update({ icon: result.image.id });
    } catch { setError('Could not upload the icon. Try again.'); }
    finally { setUploading(false); }
  };
  const preview = () => uploaded() && uploaded()!.id === settings().icon ? uploaded()!.url : settings().icon ? `/a/${settings().icon}/raw` : `${artifactAppPath(props.id)}icon-192.png`;
  return <section aria-label="PWA settings" class="mx-auto max-w-3xl space-y-8">
    <header><h2 class="text-xl font-semibold text-fg">Install as an app</h2><p class="mt-2 text-sm text-muted">This artifact is ready to install. Give it a name and icon for the home screen or desktop.</p></header>
    <div class="flex items-center gap-4"><img src={preview()} alt="App icon preview" class="h-20 w-20 rounded-xl border border-edge object-contain" /><div><p class="font-semibold text-fg">{settings().name ?? props.title ?? 'Untitled artifact'}</p><p class="mt-1 text-sm text-muted">{settings().icon ? 'Custom app icon' : 'Generated icon · unique to this artifact'}</p></div></div>
    <div class="grid gap-5 sm:grid-cols-2">
      <label class="text-sm text-muted">App name<input aria-label="App name" class={INPUT} maxLength={100} placeholder={props.title || 'Untitled artifact'} value={settings().name ?? ''} onBlur={e => update({ name: e.currentTarget.value.trim() || undefined })} /></label>
      <label class="text-sm text-muted">Short name<input aria-label="Short name" class={INPUT} maxLength={30} placeholder="Uses app name" value={settings().shortName ?? ''} onBlur={e => update({ shortName: e.currentTarget.value.trim() || undefined })} /></label>
    </div>
    <div class="space-y-3"><label class="block text-sm text-muted">App icon<input type="file" aria-label="Upload app icon" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" disabled={uploading()} class={INPUT} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} /></label>
      <p class="text-xs text-muted">A separate image from your social preview. Square artwork works best; we pad it and create the required icon sizes.</p>
      <Show when={settings().icon}><button type="button" disabled={uploading()} class="text-sm text-accent underline" onClick={() => update({ icon: undefined })}>Use generated icon</button></Show>
      <Show when={uploading()}><p role="status" class="text-sm text-muted">Uploading icon…</p></Show>
    </div>
    <div class="grid gap-5 sm:grid-cols-2">
      <label class="text-sm text-muted">Theme color<input type="color" aria-label="Theme color" class={INPUT} value={settings().themeColor ?? '#ffffff'} onChange={e => update({ themeColor: e.currentTarget.value })} /></label>
      <label class="text-sm text-muted">Background color<input type="color" aria-label="Background color" class={INPUT} value={settings().backgroundColor ?? '#ffffff'} onChange={e => update({ backgroundColor: e.currentTarget.value })} /></label>
    </div>
    <Show when={error()}><p role="alert" class="text-sm text-danger">{error()}</p></Show>
    <div class="space-y-3 border-t border-edge pt-5"><InstallArtifactLink id={props.id} class="inline-flex items-center gap-2 text-sm font-semibold text-accent" />
      <p class="text-sm text-muted">Opens the latest saved version in its own window. Internet access and the artifact’s existing sharing permissions still apply.</p>
      <p class="text-xs text-muted">Names and icons may take time to update in installed apps. Reinstall to see changes immediately.</p>
      <a href={artifactAppPath(props.id)} target="_self" class="block break-all text-xs text-muted underline">{window.location.origin}{artifactAppPath(props.id)}</a>
    </div>
  </section>;
}
