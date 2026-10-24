/* @jsxImportSource solid-js */
/** The hosted bar's local-file presentation: shared controls, no router, account provider or network. */
import { createSignal, Show, type JSX } from 'solid-js';
import Download from 'lucide-solid/icons/download';
import CloudUpload from 'lucide-solid/icons/cloud-upload';
import Plug from 'lucide-solid/icons/plug';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { PageBar } from '../components/PageBar';
import { Button } from '../ui/Button';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { portablePublishOrigin, PORTABLE_CHROME_HEIGHT } from '@/lib/html-runtime/portable-chrome-contract';
import type { PortableChromeIdentity, PortablePreviewStatus, SavePortableOptions, PortableChromeOptions, PortableChromeUpdate } from '@/lib/html-runtime/portable-chrome-contract';

const LABEL = {
  offline: 'Offline', connecting: 'Connecting…', connected: 'Connected', 'signin-required': 'Sign in required',
  'permission-required': 'Permission required', blocked: 'Connection blocked', stale: 'Original changed',
  unavailable: 'Connection unavailable', 'unknown-outcome': 'Action not confirmed',
} as const;
const NOTICE = {
  offline: 'Your file stays on this device until you connect.',
  connecting: 'Connecting to the original. You can keep working offline.',
  connected: 'Remote access is connected. Save HTML keeps a local copy.',
  'signin-required': 'Sign in to connect, or stay offline.',
  'permission-required': 'Approve access to connect, or stay offline.',
  blocked: 'Connection was blocked. You can still save your HTML.',
  stale: 'The original has changed. Your local file is preserved.',
  unavailable: 'The original is unavailable. You can still save your HTML.',
  'unknown-outcome': 'The last remote action was not confirmed. Check the original before trying again.',
} as const;

export function PortableChrome(props: Omit<PortableChromeOptions, 'win' | 'stylesheet' | 'state' | 'title'> & { current: PortableChromeUpdate }): JSX.Element {
  const kind = () => props.current.kind ?? props.kind;
  const mode = () => props.current.mode ?? props.mode ?? 'light';
  const identity = (): PortableChromeIdentity | undefined => props.current.identity ?? props.identity;
  const [publishOpen, setPublishOpen] = createSignal(false);
  const [publishOrigin, setPublishOrigin] = createSignal(props.publishOrigin ?? '');
  const [publishError, setPublishError] = createSignal<string>();
  const publish = () => {
    const platformOrigin = portablePublishOrigin(publishOrigin());
    if (!platformOrigin) { setPublishError('Enter an HTTPS platform origin, without a path or sign-in details.'); return; }
    setPublishError(undefined); setPublishOpen(false); props.onPublish({ platformOrigin });
  };
  const [includePrivateState, setIncludePrivateState] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal(false);
  const save = async () => {
    if (saving()) return;
    setSaving(true); setSaveError(false);
    const choice: SavePortableOptions = { includePrivateState: includePrivateState() };
    try { await props.onSave(choice); }
    catch { setSaveError(true); }
    finally { setSaving(false); }
  };
  const notice = () => {
    if (saveError()) return 'Could not save HTML. Try again.';
    const preview: PortablePreviewStatus | undefined = props.current.previewStatus;
    if (preview?.error) return preview.error;
    if (preview?.changed && preview.conflict) return 'File changed on disk. Local dataset edits conflict with this file; review them before reloading.';
    if (preview?.changed && preview.dirty) return 'File changed on disk. Local dataset edits are unsaved; review them before reloading.';
    if (preview?.conflict) return 'Local dataset edits conflict with the file on disk. Reload to review.';
    if (preview?.dirty) return 'Local dataset edits are unsaved. Review them before reloading.';
    if (preview?.changed) return 'File changed on disk. Reload to view it.';
    if (props.current.notice) return props.current.notice;
    if (preview?.connected) return 'Private preview is connected. Save HTML keeps a local copy.';
    return kind() === 'unpublished' && props.current.state === 'offline' ? 'Unpublished local file. Publish when you’re ready.' : NOTICE[props.current.state];
  };
  const items = (): MenuEntry[] => {
    const entries: MenuEntry[] = [{ label: 'Include private filters and drafts', text: 'Include private filters and drafts', checked: includePrivateState(), onSelect: () => setIncludePrivateState(value => !value) },
      { separator: true },
      { label: 'Light mode', text: 'Light', checked: mode() === 'light', onSelect: () => props.onMode?.('light') },
      { label: 'Dark mode', text: 'Dark', checked: mode() === 'dark', onSelect: () => props.onMode?.('dark') }];
    if (kind() === 'linked' && identity()) entries.push({ label: 'Open original', text: 'Open original', onSelect: props.onOpenHosted });
    if (props.current.state === 'connected') entries.push({ label: 'Disconnect', text: 'Disconnect', onSelect: props.onDisconnect });
    else if (props.current.state !== 'offline') entries.push({ label: 'Stay offline', text: 'Stay offline', onSelect: props.onStayOffline });
    return entries;
  };
  const source = () => {
    if (kind() === 'unpublished') return 'Local file';
    try { return `Original: ${new URL(identity()?.platformOrigin ?? '').host}`; }
    catch { return 'Local copy of original'; }
  };
  return <><section aria-label="Local HTML controls" data-app-appearance={mode()} class="fixed inset-x-0 top-0 z-40 font-sans text-fg" style={{ height: `${PORTABLE_CHROME_HEIGHT}px` }}>
    <PageBar home={null} mobileTitle={props.current.title ?? 'Local document'}
      navigation={<span class="min-w-0 truncate">{props.current.title ?? 'Local document'}</span>}
      actions={<>
        <Button variant="secondary" size="bar" aria-label="Save HTML" disabled={saving()} onClick={() => void save()}><Download size={17} /><span class="hidden sm:inline">{saving() ? 'Saving…' : 'Save HTML'}</span></Button>
        <Show when={kind() === 'unpublished'} fallback={
          <Button variant="secondary" size="bar" aria-label="Connect original" disabled={props.current.state === 'connecting' || props.current.state === 'connected'} onClick={props.onConnect}><Plug size={17} /><span class="hidden sm:inline">Connect original</span></Button>
        }><Button variant="primary" size="bar" aria-label="Publish" onClick={() => setPublishOpen(true)}><CloudUpload size={17} /><span class="hidden sm:inline">Publish</span></Button></Show>
        <Menu label="Local file actions" items={items()} trigger={attrs => <Button {...attrs} variant="ghost" size="bar" icon aria-label="Local file actions"><Ellipsis size={20} /></Button>} />
      </>} />
    <div role="status" aria-live="polite" class="flex h-8 min-w-0 items-center gap-2 border-b border-edge bg-surface px-3 font-mono text-micro text-muted">
      <span class="shrink-0 text-fg">{LABEL[props.current.state]}</span>
      <span class="min-w-0 truncate">{notice()}</span>
      <Show when={props.current.previewStatus?.changed || props.current.previewStatus?.dirty || props.current.previewStatus?.conflict}><Button variant="secondary" size="sm" aria-label="Reload file" disabled={!props.onReloadPreview} onClick={() => props.onReloadPreview?.()}>Reload</Button></Show>
      <span class="ml-auto hidden shrink-0 sm:inline">{props.current.sourceStatus ?? source()}</span>
    </div>
  </section>
    <Show when={publishOpen() && kind() === 'unpublished'}>
      <Dialog title="Publish local file" description="Choose the platform where you want to publish. You’ll review the files and approve publishing there." onClose={() => setPublishOpen(false)}
        initialFocus="input" footer={<><Button variant="secondary" onClick={() => setPublishOpen(false)}>Cancel</Button><Button onClick={publish}>Publish</Button></>}>
        <Field label="Platform URL" hint="Use the platform’s origin, such as https://platform.example." error={publishError()}>
          <Input type="url" value={publishOrigin()} placeholder="https://platform.example" autocomplete="url" onInput={event => { setPublishOrigin(event.currentTarget.value); setPublishError(undefined); }} />
        </Field>
      </Dialog>
    </Show>
  </>;
}
