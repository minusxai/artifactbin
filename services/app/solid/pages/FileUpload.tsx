/* @jsxImportSource solid-js */
import { creationDestination } from '../lib/creation-destination';
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { Check, Copy, FileUp } from 'lucide-solid';
import AssetPageHeader from '../components/AssetPageHeader';
import { FILE_ACTION as ACTION, FileViewer, extensionOf } from '../components/FileViewer';
import { LINK } from '../ui/ui';
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
  const [dragging, setDragging] = createSignal(false);
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
  const onDrop: JSX.EventHandlerUnion<HTMLButtonElement, DragEvent> = (event) => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void pick(file);
  };
  return <Show when={!session()?.user && session()} fallback={
    <main class="workspace-page">
      <AssetPageHeader icon={FileUp} eyebrow="Asset upload" title="Upload a file" link={{ href: '/assets', label: 'Back to assets', text: 'all assets' }} />
      <div class="mx-auto max-w-4xl space-y-6"><section aria-label="Upload a file" class="rounded-xl border border-edge bg-surface p-5">
        <input ref={input} type="file" accept={ACCEPT} aria-label="Choose a file" class="hidden"
          onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void pick(file); }} />
        <Show when={picked()} fallback={<button type="button" onClick={() => input.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          class={`flex h-56 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors ${dragging() ? 'border-accent bg-accent-soft' : 'border-edge-bright bg-raised/40 hover:border-accent'}`}>
          <FileUp aria-hidden="true" size={24} strokeWidth={1.6} class="text-accent" />
          <span class="text-sm text-fg">Drop a file here, or click to choose one</span>
          <span class="text-xs text-muted">Images, pdf, video, audio, text, fonts and glb models</span>
        </button>}>
          {(selected) => <>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span class="min-w-0 truncate font-medium text-fg">{selected().file.name}</span>
              <span class="text-xs text-muted">{formatFileSize(selected().file.size)}</span>
              <Show when={!result()}><button type="button" onClick={() => input.click()} class={`ml-auto cursor-pointer font-mono text-xs ${LINK}`}>choose another</button></Show>
            </div>
            <div class="mt-4"><FileViewer name={selected().file.name} size={selected().file.size} url={selected().url} blob={selected().file} pdfUrl={result() ? `/a/${result()!.id}/raw` : null} downloadUrl={result() ? `/a/${result()!.id}/raw` : undefined} /></div>
            <Show when={result()} fallback={<div class="mt-5 flex flex-wrap items-end gap-3">
              <label class="grid min-w-48 flex-1 gap-1.5 text-xs text-muted">Title
                <input class="w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg" value={title()} onInput={(event) => setTitle(event.currentTarget.value)} placeholder={selected().file.name} />
              </label>
              <button type="button" onClick={() => void upload()} disabled={busy()} class="inline-flex items-center gap-1.5 rounded border border-accent bg-accent px-3 py-2 font-mono text-xs text-bg disabled:opacity-50">
                <FileUp aria-hidden="true" size={13} />{busy() ? 'Uploading…' : 'Upload'}
              </button>
            </div>}>
              {(uploaded) => <div aria-label="Uploaded file" class="mt-5 rounded-lg border border-edge bg-raised/40 p-4">
                <div class="flex items-center gap-3">
                  <p class="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg"><Check aria-hidden="true" size={15} class="shrink-0 text-accent" /><span class="shrink-0">Uploaded as</span><span class="truncate font-medium">{title().trim() || selected().file.name}</span></p>
                  <button type="button" aria-label="Copy file reference" onClick={() => { void copyText(`ref:${uploaded().id}`); setCopied(true); }} class={`${ACTION} shrink-0 border-edge-bright bg-surface text-accent hover:border-accent`}>
                    ref:{uploaded().id}{copied() ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
                  </button>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-2">
                  <a href={`/a/${uploaded().id}`} aria-label="Open artifact" class={`${ACTION} justify-center border-accent bg-accent py-2 font-semibold text-bg hover:brightness-110`}>Open artifact →</a>
                  <button type="button" onClick={reset} class={`${ACTION} justify-center border-edge-bright bg-surface py-2 text-fg hover:border-accent`}>Upload another</button>
                </div>
              </div>}
            </Show>
          </>}
        </Show>
        <Show when={error()}><p role="alert" class="mt-4 rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error()}</p></Show>
      </section></div>
    </main>
  }><Navigate href="/login?callbackUrl=%2Ffiles%2Fnew" /></Show>;
}

