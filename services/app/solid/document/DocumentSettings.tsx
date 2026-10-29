/* @jsxImportSource solid-js */
import { createResource, createSignal, Show, type JSX } from 'solid-js';
import {createHttpBackend} from '@/lib/artifact-backend/http';
import type { ArtifactBackend, ArtifactHead } from '@/lib/artifact-backend';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import { contextRefOf } from '@/lib/document/helmet';
import { writeContextRef } from '@/lib/document/context';
import { readPwaSettings } from '@/lib/document/pwa-settings';
import ContextPanel from '../editor/ContextPanel';
import ReferenceFilesPanel from '../editor/ReferenceFilesPanel';
import { PwaSettingsPanel, PwaSharingSetting } from '../editor/PwaSettingsPanel';
import { Dialog } from '../ui/Dialog';
import { Tabs } from '../ui/Tabs';
import { StatusMessage } from '../ui/StatusMessage';

export interface DocumentSettingsProps {
  id: string;
  title: string;
  backend?: ArtifactBackend;
  onPwaEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
}
/** Reader settings own metadata changes; source and document editing are not exposed. */
export default function DocumentSettings(props: DocumentSettingsProps): JSX.Element {
  const backend=props.backend??createHttpBackend(props.id);
  const [head, { mutate }] = createResource(() => backend.load());
  const [tab, setTab] = createSignal('app');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const save = async (source: string) => {
    const base = head();
    if (!base || busy()) return;
    setBusy(true); setError('');
    try {
      const response = await writeBrowserArtifact(props.id, { source }, base.edit_id);
      if (!response.ok) throw new Error('Could not save settings. Refresh and try again.');
      const next = await backend.load();
      if (!next) throw new Error('Settings were saved. Refresh to load the current version.');
      mutate(next);
      props.onPwaEnabledChange(readPwaSettings(next.markup ?? '').enabled === true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  };
  const content = (current: ArtifactHead) => <>
    <Tabs label="Artifact settings" value={tab()} onChange={setTab} items={[{ value: 'app', label: 'App' }, { value: 'context', label: 'Context' }, { value: 'files', label: 'Files' }]} />
    <div class="mt-5" aria-busy={busy()} inert={busy()}>
      <Show when={tab() === 'app'}><PwaSharingSetting source={current.markup ?? ''} onChange={(source) => void save(source)} /><PwaSettingsPanel id={props.id} title={props.title} source={current.markup ?? ''} onChange={(source) => void save(source)} onUpload={(file) => backend.importImage({ file, name: file.name })} beforeInstall={async () => !busy()} /></Show>
      <Show when={tab() === 'context'}><ContextPanel id={contextRefOf(current.markup ?? '')} backend={backend} onChange={(id) => void save(writeContextRef(current.markup ?? '', id))} /></Show>
      <Show when={tab() === 'files'}><ReferenceFilesPanel refs={current.refs ?? []} /></Show>
    </div>
  </>;
  return <Dialog title="Artifact settings" size="xl" closeLabel="Close settings" busy={busy()} onClose={props.onClose}>
    <Show when={!head.loading} fallback={<StatusMessage kind="loading">Loading settings…</StatusMessage>}>
      <Show when={head()} keyed fallback={<StatusMessage kind="error">Settings are unavailable. Refresh and try again.</StatusMessage>}>{content}</Show>
    </Show>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
  </Dialog>;
}
