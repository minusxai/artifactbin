/* @jsxImportSource solid-js */
import { createMemo, createSignal, Show } from 'solid-js';
import type { ImageChoice } from '@/lib/artifact-backend/types';
import { artifactAppPath } from '@/lib/serving/artifact-pwa';
import { readPwaSettings, writePwaSettings, type PwaSettings } from '@/lib/document/pwa-settings';
import { InstallArtifactLink } from '../document/InstallArtifact';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Checkbox';
import { Field, Input } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';

interface PwaSettingsPanelProps { id: string; title: string; source: string; onChange: (source: string) => void; onUpload: (file: File) => Promise<ImageChoice>; beforeInstall?: () => Promise<boolean> }
// No ui primitive draws a color well; the two `type="color"` inputs below stay native (their white defaults are data, the colour a settings value falls back to).
const COLOR_WELL = 'mt-1 h-10 w-full cursor-pointer rounded-control border border-edge bg-ground p-1';

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
  let iconFile: HTMLInputElement | undefined;
  const preview = () => uploaded() && uploaded()!.id === settings().icon ? uploaded()!.url : settings().icon ? `/a/${settings().icon}/raw` : `${artifactAppPath(props.id)}icon-192.png`;
  return <section aria-label="PWA settings" class="mx-auto max-w-3xl space-y-8">
    <header><SectionHeading>Install as an app</SectionHeading><p class="mt-2 text-sm text-muted">This artifact is ready to install. Give it a name and icon for the home screen or desktop.</p></header>
    <div class="flex items-center gap-4"><img src={preview()} alt="App icon preview" class="size-20 rounded-panel border border-edge object-contain" /><div><p class="font-semibold text-fg">{settings().name ?? props.title ?? 'Untitled artifact'}</p><p class="mt-1 text-sm text-muted">{settings().icon ? 'Custom app icon' : 'Generated icon · unique to this artifact'}</p></div></div>
    <div class="grid gap-5 sm:grid-cols-2">
      <Field label="App name"><Input maxLength={100} placeholder={props.title || 'Untitled artifact'} value={settings().name ?? ''} onBlur={e => update({ name: e.currentTarget.value.trim() || undefined })} /></Field>
      <Field label="Short name"><Input maxLength={30} placeholder="Uses app name" value={settings().shortName ?? ''} onBlur={e => update({ shortName: e.currentTarget.value.trim() || undefined })} /></Field>
    </div>
    <div class="space-y-3"><div class="grid gap-1.5"><span class="font-sans text-sm font-medium text-fg">App icon</span>
      <input ref={iconFile} hidden type="file" aria-label="Upload app icon" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" disabled={uploading()} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} />
      <Button variant="secondary" class="justify-self-start" disabled={uploading()} onClick={() => iconFile?.click()}>Choose icon…</Button></div>
      <p class="text-xs text-muted">A separate image from your social preview. Square artwork works best; we pad it and create the required icon sizes.</p>
      <Show when={settings().icon}><Button variant="link" disabled={uploading()} onClick={() => update({ icon: undefined })}>Use generated icon</Button></Show>
      <Show when={uploading()}><StatusMessage kind="loading">Uploading icon…</StatusMessage></Show>
    </div>
    <div class="grid gap-5 sm:grid-cols-2">
      <label class="text-sm text-muted">Theme color<input type="color" aria-label="Theme color" class={COLOR_WELL} value={settings().themeColor ?? '#ffffff'} onChange={e => update({ themeColor: e.currentTarget.value })} /><span class="mt-1 block text-xs">App title bar and browser toolbar, where supported.</span></label>
      <label class="text-sm text-muted">Background color<input type="color" aria-label="Background color" class={COLOR_WELL} value={settings().backgroundColor ?? '#ffffff'} onChange={e => update({ backgroundColor: e.currentTarget.value })} /><span class="mt-1 block text-xs">Loading screen and padding around your app icon.</span></label>
    </div>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <div class="space-y-3 border-t border-edge pt-5"><InstallArtifactLink id={props.id} beforeNavigate={props.beforeInstall} class="inline-flex items-center gap-2 text-sm font-semibold text-accent" />
      <p class="text-sm text-muted">Opens the latest saved version in its own window. Internet access and the artifact’s existing sharing permissions still apply.</p>
      <p class="text-xs text-muted">Names and icons may take time to update in installed apps. Reinstall to see changes immediately.</p>
      <a href={artifactAppPath(props.id)} target="_self" class="block break-all text-xs text-muted underline">{window.location.origin}{artifactAppPath(props.id)}</a>
    </div>
  </section>;
}

export function PwaSharingSetting(props: { source: string; onChange: (source: string) => void }) {
  const settings = () => readPwaSettings(props.source);
  return <section aria-label="App installation" class="mx-auto max-w-3xl border-t border-edge pt-5">
    <div class="flex items-center justify-between gap-4 text-sm font-medium text-fg">
      <span>Allow installation as a PWA</span>
      <Switch label="Allow installation as a PWA" checked={settings().enabled === true}
        onChange={enabled => props.onChange(writePwaSettings(props.source, { ...settings(), enabled }))} />
    </div>
    <p class="mt-2 text-sm text-muted">Let readers install this artifact on their home screen or desktop. Sharing permissions still apply.</p>
    <Show when={settings().enabled}><p class="mt-2 text-xs text-muted">Customize its name, icon and colors in the PWA tab.</p></Show>
  </section>;
}
