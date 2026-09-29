/* @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, Switch, Match, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { Dynamic } from 'solid-js/web';
import { Box, Check, Copy, Download, File as FileIcon, FileArchive, FileSpreadsheet, FileUp } from 'lucide-solid';
import AssetPageHeader from '../components/AssetPageHeader';
import ModelPreview from '../components/ModelPreview';
import { LINK } from '../components/ui';
import { formatFileSize } from '@/lib/file-display';
import { FILE_EXTENSIONS, assetFormatOf, fileContentType } from '@/lib/story/file-types';
import { useSession } from '../web/session';

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'font' | 'model' | 'other';
const KIND_BY_EXTENSION: Record<string, Kind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  pdf: 'pdf', mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  txt: 'text', csv: 'text', json: 'text',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', glb: 'model',
};
const ACCEPT = FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const TEXT_PREVIEW_BYTES = 8_000;
const ACTION = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border px-3 py-1.5 font-mono text-xs no-underline transition-colors';
const extensionOf = (name: string) => { const dot = name.lastIndexOf('.'); return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase(); };
const readAs = (file: Blob, mode: 'dataUrl' | 'text') => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  if (mode === 'text') reader.readAsText(file); else reader.readAsDataURL(file);
});
interface Picked { file: File; url: string; kind: Kind; text: string | null }

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
    const kind = KIND_BY_EXTENSION[extensionOf(file.name)] ?? 'other';
    const text = kind === 'text' ? await readAs(file.slice(0, TEXT_PREVIEW_BYTES), 'text').catch(() => null) : null;
    setPicked({ file, url: URL.createObjectURL(file), kind, text });
    setTitle(file.name.replace(/\.[^.]+$/, ''));
  };
  const upload = async () => {
    const selected = picked();
    if (!selected || busy()) return;
    setBusy(true); setError('');
    try {
      const dataUrl = await readAs(selected.file, 'dataUrl');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const contentType = fileContentType(selected.file.name) ?? selected.file.type ?? 'application/octet-stream';
      const door = assetFormatOf(selected.file.name);
      const content = door === 'image' ? { image: `data:${contentType};base64,${base64}` }
        : door === 'pdf' ? { pdf: `data:application/pdf;base64,${base64}` }
          : { file: { filename: selected.file.name, contentType, base64 } };
      const response = await fetch('/api/my/artifacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, title: title().trim() || selected.file.name, parent_id: parentId }),
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
    <main class="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
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
            <div class="mt-4"><Preview picked={selected()} storedUrl={result() ? `/a/${result()!.id}/raw` : null} /></div>
            <Show when={result()} fallback={<div class="mt-5 flex flex-wrap items-end gap-3">
              <label class="grid min-w-48 flex-1 gap-1.5 text-xs text-muted">Title
                <input class="w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg" value={title()} onInput={(event) => setTitle(event.currentTarget.value)} placeholder={selected().file.name} />
              </label>
              <button type="button" onClick={() => void upload()} disabled={busy()} class="inline-flex items-center gap-1.5 rounded border border-accent bg-accent px-3 py-2 font-mono text-xs text-bg disabled:opacity-50">
                <FileUp aria-hidden="true" size={13} />{busy() ? 'Uploading…' : 'Upload'}
              </button>
            </div>}>
              {(uploaded) => <div aria-label="Uploaded file" class="mt-5 rounded-lg border border-edge bg-raised/40 p-4">
                <p class="flex items-center gap-2 text-sm text-fg"><Check aria-hidden="true" size={15} class="text-accent" />Uploaded as <span class="font-medium">{title().trim() || selected().file.name}</span></p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <a href={`/a/${uploaded().id}`} aria-label="Open artifact" class={`${ACTION} border-accent bg-accent font-semibold text-bg hover:brightness-110`}>Open artifact →</a>
                  <button type="button" aria-label="Copy file reference" onClick={() => { void navigator.clipboard?.writeText(`ref:${uploaded().id}`); setCopied(true); }} class={`${ACTION} border-edge-bright bg-surface text-accent hover:border-accent`}>
                    ref:{uploaded().id}{copied() ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
                  </button>
                  <button type="button" onClick={reset} class={`${ACTION} border-edge-bright bg-surface text-fg`}>Upload another</button>
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

function Preview(props: { picked: Picked; storedUrl: string | null }): JSX.Element {
  const file = () => props.picked.file;
  const url = () => props.picked.url;
  return <Switch fallback={<DownloadCard file={file()} url={props.storedUrl ?? url()} note="no preview for this type" />}>
    <Match when={props.picked.kind === 'image'}><img src={url()} alt={file().name} class="max-h-[28rem] max-w-full rounded-lg border border-edge" /></Match>
    <Match when={props.picked.kind === 'pdf'}><Show when={props.storedUrl} fallback={<DownloadCard file={file()} url={url()} note="previews once uploaded" />}>
      {(stored) => <iframe src={stored()} title={file().name} class="h-[32rem] w-full rounded-lg border border-edge bg-surface" />}
    </Show></Match>
    <Match when={props.picked.kind === 'video'}><video src={url()} controls aria-label={file().name} class="max-h-[28rem] w-full rounded-lg border border-edge bg-black" /></Match>
    <Match when={props.picked.kind === 'audio'}><audio src={url()} controls aria-label={file().name} class="w-full" /></Match>
    <Match when={props.picked.kind === 'text'}><pre aria-label={`Preview of ${file().name}`} class="max-h-[28rem] overflow-auto rounded-lg border border-code-edge bg-code p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg">{props.picked.text ?? ''}{props.picked.text !== null && file().size > TEXT_PREVIEW_BYTES ? '\n…' : ''}</pre></Match>
    <Match when={props.picked.kind === 'font'}><FontPreview file={file()} name={file().name} /></Match>
    <Match when={props.picked.kind === 'model'}><ModelPreview source={file()} title={file().name} /></Match>
  </Switch>;
}

function FontPreview(props: { file: Blob; name: string }): JSX.Element {
  const family = `mx-preview-${Math.random().toString(36).slice(2, 8)}`;
  const [state, setState] = createSignal<'loading' | 'ready' | 'error'>('loading');
  createEffect(() => {
    if (typeof FontFace === 'undefined') { setState('error'); return; }
    let cancelled = false;
    let face: FontFace | null = null;
    void props.file.arrayBuffer().then((bytes) => { face = new FontFace(family, bytes); return face.load(); })
      .then((loaded) => { if (!cancelled) { document.fonts.add(loaded); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    onCleanup(() => { cancelled = true; if (face) document.fonts.delete(face); });
  });
  return <div aria-label={`Font preview of ${props.name}`} class="rounded-lg border border-edge bg-raised/40 p-6" style={state() === 'ready' ? { 'font-family': `'${family}', sans-serif` } : undefined}>
    <p class="text-3xl leading-tight text-fg">The quick brown fox jumps over the lazy dog</p>
    <p class="mt-2 text-base text-muted">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
    <Show when={state() !== 'ready'}><p class="mt-3 font-mono text-[10px] text-faint">{state() === 'loading' ? 'loading font…' : 'this font could not be loaded for preview'}</p></Show>
  </div>;
}
function DownloadCard(props: { file: File; url: string; note: string }): JSX.Element {
  const extension = () => extensionOf(props.file.name);
  const Icon = () => ['gltf', 'obj', 'fbx', 'stl'].includes(extension()) ? Box : extension() === 'xlsx' ? FileSpreadsheet : extension() === 'zip' ? FileArchive : FileIcon;
  return <div aria-label={`File summary of ${props.file.name}`} class="flex items-center gap-4 rounded-lg border border-edge bg-raised/40 p-5">
    <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface text-accent"><Dynamic component={Icon()} aria-hidden="true" size={26} strokeWidth={1.5} /></span>
    <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-fg">{props.file.name}</p><p class="mt-0.5 text-xs text-muted">.{extension()} · {formatFileSize(props.file.size)} · {props.note}</p></div>
    <a href={props.url} download={props.file.name} aria-label={`Download ${props.file.name}`} class={`${ACTION} border-edge-bright text-fg hover:border-accent hover:text-accent`}><Download aria-hidden="true" size={13} />Download</a>
  </div>;
}
