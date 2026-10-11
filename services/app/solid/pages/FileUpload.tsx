/* @jsxImportSource solid-js */
import { creationDestination } from '../lib/creation-destination';
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { Check, Copy, FileUp } from 'lucide-solid';
import AssetPageHeader from '../components/AssetPageHeader';
import { FileViewer, extensionOf } from '../components/FileViewer';
import { Button } from '../ui/Button';
import { DropZone } from '../ui/DropZone';
import { Field, Input } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';

import { formatFileSize } from '@/lib/islands/file-display';
import { FILE_EXTENSIONS, assetFormatOf, fileContentType } from '@artifactbin/contracts';
import { useSession } from '../lib/session';
import { copyText } from '../lib/copy-text';

const ACCEPT = FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const readAs = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsDataURL(file);
});
interface Picked { file: File; url: string }

export function FileUploadPage(): JSX.Element {
  const { session } = useSession();
  const parentId = new URLSearchParams(window.location.search).get('parent_id');
  let input!: HTMLInputElement;
  const [picked, setPicked] = createSignal<Picked | null>(null);
  const [title, setTitle] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<{ id: string } | null>(null);
  const [copied, setCopied] = createSignal(false);
  createEffect(() => { const url = picked()?.url; if (url) onCleanup(() => URL.revokeObjectURL(url)); });

  const pick = async (file: File) => {
    setError(''); setResult(null); setCopied(false);
    if (!assetFormatOf(file.name)) {
      const extension = extensionOf(file.name);
      setError(`${extension ? `.${extension} files are` : 'That file is'} not accepted. Accepted: ${FILE_EXTENSIONS.join(', ')}.`);
      return;
    }
    setPicked({ file, url: URL.createObjectURL(file) });
    setTitle(file.name.replace(/\.[^.]+$/, ''));
  };
  const upload = async () => {
    const selected = picked();
    if (!selected || busy()) return;
    setBusy(true); setError('');
    try {
      const dataUrl = await readAs(selected.file);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const contentType = fileContentType(selected.file.name) ?? selected.file.type ?? 'application/octet-stream';
      const door = assetFormatOf(selected.file.name);
      const content = door === 'image' ? { image: `data:${contentType};base64,${base64}` }
        : door === 'pdf' ? { pdf: `data:application/pdf;base64,${base64}` }
          : { file: { filename: selected.file.name, contentType, base64 } };
      const response = await fetch('/api/my/artifacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, title: title().trim() || selected.file.name, parent_id: parentId, destination: creationDestination(window.location.search) }),
      }).catch(() => null);
      if (!response) { setError('Upload failed. Check your connection and try again.'); return; }
      const data = (await response.json().catch(() => ({}))) as { id?: string; details?: string[]; maxBytes?: number };
      if (!response.ok || !data.id) {
        setError(response.status === 413 ? `That file is too large${data.maxBytes ? ` (the limit is ${formatFileSize(data.maxBytes)})` : ''}.`
          : data.details?.[0] ?? (response.status === 403 ? 'You have reached your limit.' : 'Could not upload that file.'));
        return;
      }
      setResult({ id: data.id });
    } finally { setBusy(false); }
  };
  const reset = () => { setPicked(null); setTitle(''); setResult(null); setError(''); setCopied(false); };
  return <Show when={!session()?.user && session()} fallback={
    <main class="workspace-page">
      <AssetPageHeader icon={FileUp} eyebrow="Asset upload" title="Upload a file" link={{ href: '/assets', label: 'Back to assets', text: 'all assets' }} />
      <div class="mx-auto max-w-4xl space-y-6"><Panel label="Upload a file" padding="sm">
        <Show when={picked()} fallback={<DropZone label="Choose a file" accept={ACCEPT} icon={() => <FileUp size={24} strokeWidth={1.6} />}
          title="Drop a file here, or click to choose one" hint="Images, pdf, video, audio, text, fonts and glb models" onFiles={([file]) => { if (file) void pick(file); }} />}>
          {(selected) => <>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span class="min-w-0 truncate font-medium text-fg">{selected().file.name}</span>
              <span class="text-xs text-muted">{formatFileSize(selected().file.size)}</span>
              <Show when={!result()}>
                {/* DropZone owns its picker and offers no way to reopen it from outside, so re-picking keeps this one hidden input. */}
                <input ref={input} type="file" accept={ACCEPT} aria-label="Choose another file" hidden
                  onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void pick(file); }} />
                <Button variant="secondary" size="sm" type="button" onClick={() => input.click()} class="ml-auto">choose another</Button>
              </Show>
            </div>
            <div class="mt-4"><FileViewer name={selected().file.name} size={selected().file.size} url={selected().url} blob={selected().file} pdfUrl={result() ? `/a/${result()!.id}/raw` : null} downloadUrl={result() ? `/a/${result()!.id}/raw` : undefined} /></div>
            <Show when={result()} fallback={<div class="mt-5 flex flex-wrap items-end gap-3">
              <Field label="Title" class="min-w-48 flex-1">
                <Input value={title()} onInput={(event) => setTitle(event.currentTarget.value)} placeholder={selected().file.name} />
              </Field>
              <Button type="button" onClick={() => void upload()} disabled={busy()}>
                <FileUp aria-hidden="true" size={13} />{busy() ? 'Uploading…' : 'Upload'}
              </Button>
            </div>}>
              {(uploaded) => <Panel label="Uploaded file" padding="sm" class="mt-5">
                <div class="flex flex-wrap items-center gap-3">
                  <p class="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg"><Check aria-hidden="true" size={15} class="shrink-0 text-accent" /><span class="shrink-0">Uploaded as</span><span class="truncate font-medium">{title().trim() || selected().file.name}</span></p>
                  <Button variant="secondary" size="sm" type="button" aria-label="Copy file reference" onClick={() => { void copyText(`ref:${uploaded().id}`); setCopied(true); }}>
                    ref:{uploaded().id}{copied() ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
                  </Button>
                </div>
                <div class="mt-4 grid gap-2 sm:grid-cols-2">
                  <Button href={`/a/${uploaded().id}`} aria-label="Open artifact">Open artifact →</Button>
                  <Button variant="secondary" type="button" onClick={reset}>Upload another</Button>
                </div>
              </Panel>}
            </Show>
          </>}
        </Show>
        <Show when={error()}><StatusMessage kind="error" class="mt-4">{error()}</StatusMessage></Show>
      </Panel></div>
    </main>
  }><Navigate href="/login?callbackUrl=%2Ffiles%2Fnew" /></Show>;
}

