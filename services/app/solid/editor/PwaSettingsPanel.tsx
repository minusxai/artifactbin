/* @jsxImportSource solid-js */
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import type { ImageChoice } from '@/lib/artifact-backend/types';
import { artifactAppPath } from '@/lib/document-serving/artifact-pwa';
import { readPwaSettings, writePwaSettings, type PwaSettings } from '@/lib/document/pwa-settings';
import { InstallArtifactLink } from '../document/InstallArtifact';
import { Button } from '../ui/Button';
import { ColorField } from '../ui/ColorField';
import { Switch } from '../ui/Checkbox';
import { Field, Input } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';

interface PwaSettingsPanelProps { id: string; title: string; source: string; onChange: (source: string) => void; onUpload: (file: File) => Promise<ImageChoice>; beforeInstall?: () => Promise<boolean> }
/** What an unset colour shows: white, the manifest's own default (a stored-settings default, not a UI colour). */
const UNSET_COLOR = '#ffffff';
/** A colour is written once it settles: dragging the picker would otherwise queue a structural source edit per frame. */
const SETTLE_MS = 300;

/** A colour well's value and its settled commit; a pending colour is committed if the panel goes away first. */
function createSettledColor(read: () => string | undefined, commit: (hex: string) => void) {
  const [draft, setDraft] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const pending = draft();
    if (pending === null) return;
    setDraft(null);
    commit(pending);
  };
  onCleanup(flush);
  return {
    value: () => draft() ?? read() ?? UNSET_COLOR,
    set: (hex: string) => { setDraft(hex); clearTimeout(timer); timer = setTimeout(flush, SETTLE_MS); },
  };
}

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
  const themeColor = createSettledColor(() => settings().themeColor, themeColor => update({ themeColor }));
  const backgroundColor = createSettledColor(() => settings().backgroundColor, backgroundColor => update({ backgroundColor }));
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
      <Field label="Theme color" hint="App title bar and browser toolbar, where supported."><ColorField value={themeColor.value()} onChange={themeColor.set} /></Field>
      <Field label="Background color" hint="Loading screen and padding around your app icon."><ColorField value={backgroundColor.value()} onChange={backgroundColor.set} /></Field>
    </div>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <div class="space-y-3 border-t border-edge pt-5"><InstallArtifactLink id={props.id} beforeNavigate={props.beforeInstall} />
      <p class="text-sm text-muted">Opens the latest saved version in its own window. Internet access and the artifact’s existing sharing permissions still apply.</p>
      <p class="text-xs text-muted">Names and icons may take time to update in installed apps. Reinstall to see changes immediately.</p>
      <a href={artifactAppPath(props.id)} target="_self" class="block break-all text-xs text-muted underline">{window.location.origin}{artifactAppPath(props.id)}</a>
    </div>
  </section>;
}

export function PwaSharingSetting(props: { source: string; onChange: (source: string) => void }) {
  const settings = () => readPwaSettings(props.source);
  // Sans throughout, like the sharing heading above it: the editor shell around this tab is mono chrome.
  return <section aria-label="App installation" class="mx-auto max-w-3xl border-t border-edge pt-5 font-sans">
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-sm font-medium text-fg">Allow installation as a PWA</h3>
      <Switch label="Allow installation as a PWA" checked={settings().enabled === true}
        onChange={enabled => props.onChange(writePwaSettings(props.source, { ...settings(), enabled }))} />
    </div>
    <p class="mt-2 text-sm leading-relaxed text-muted">Let readers install this artifact on their home screen or desktop. Sharing permissions still apply.</p>
    <Show when={settings().enabled}><p class="mt-2 text-sm leading-relaxed text-muted">Customize its name, icon and colors in the PWA tab.</p></Show>
  </section>;
}
