/* @jsxImportSource solid-js */
/**
 * THE ONE VIEWER FOR A STORED FILE — what the upload page previews before (and after) an upload and
 * what an artifact's page shows for a pdf or a stored file, chosen by the file's extension.
 *
 * The bytes come from `url` (a blob address on the upload page, `/a/<id>/raw` on the artifact page)
 * or, when the caller already holds them, from `blob`. A PDF needs a stored address: the browser's
 * viewer is framed at `/a/<id>/raw`, so without `pdfUrl` the PDF reads as a download card.
 * A text file reads only its first {@link TEXT_PREVIEW_BYTES}, so a large CSV never downloads whole.
 */
import { createEffect, createResource, createSignal, onCleanup, Show, Switch, Match, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Box, Download, File as FileIcon, FileArchive, FileSpreadsheet } from 'lucide-solid';
import ModelPreview from './ModelPreview';
import { formatFileSize } from '@/lib/workspace/file-display';

export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'font' | 'model' | 'other';
const KIND_BY_EXTENSION: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  pdf: 'pdf', mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  txt: 'text', csv: 'text', json: 'text',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', glb: 'model',
};
const TEXT_PREVIEW_BYTES = 8_000;
export const FILE_ACTION = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border px-3 py-1.5 font-mono text-xs no-underline transition-colors';
export const extensionOf = (name: string) => { const dot = name.lastIndexOf('.'); return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase(); };
export const fileKindOf = (name: string): FileKind => KIND_BY_EXTENSION[extensionOf(name)] ?? 'other';

const readBlobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsText(blob);
});
/** The first `limit` bytes as text, stopping the download there. */
async function headText(source: Blob | string, limit: number): Promise<string> {
  if (typeof source !== 'string') return readBlobText(source.slice(0, limit));
  const response = await fetch(source);
  if (!response.ok || !response.body) throw new Error('unreadable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); length += value.length;
  }
  void reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) { const part = chunk.subarray(0, bytes.length - offset); bytes.set(part, offset); offset += part.length; if (offset >= bytes.length) break; }
  return new TextDecoder().decode(bytes);
}
const bytesOf = async (source: Blob | string) => typeof source === 'string' ? (await fetch(source)).arrayBuffer() : source.arrayBuffer();

export interface FileViewerProps {
  /** The file's name: its extension picks the viewer. */
  name: string;
  size: number;
  /** Where the bytes are read from (and downloaded from, unless `downloadUrl` says otherwise). */
  url: string;
  /** The bytes, when the caller already holds them (the upload page's picked file). */
  blob?: Blob;
  /** A stored PDF's own address, framed for the browser's viewer; null until there is one. */
  pdfUrl?: string | null;
  downloadUrl?: string;
  /** Taller viewers for a page that is only this file. */
  tall?: boolean;
}

export function FileViewer(props: FileViewerProps): JSX.Element {
  const kind = () => fileKindOf(props.name);
  const source = () => props.blob ?? props.url;
  const height = () => props.tall ? 'max-h-[75vh]' : 'max-h-[28rem]';
  const download = () => props.downloadUrl ?? props.url;
  return <Switch fallback={<DownloadCard name={props.name} size={props.size} url={download()} note="no preview for this type" />}>
    <Match when={kind() === 'image'}><img src={props.url} alt={props.name} class={`${height()} max-w-full rounded-lg border border-edge`} /></Match>
    <Match when={kind() === 'pdf'}><Show when={props.pdfUrl} fallback={<DownloadCard name={props.name} size={props.size} url={download()} note="previews once uploaded" />}>
      {(stored) => <iframe src={stored()} title={props.name} class={`${props.tall ? 'h-[80vh]' : 'h-[32rem]'} w-full rounded-lg border border-edge bg-surface`} />}
    </Show></Match>
    <Match when={kind() === 'video'}><video src={props.url} controls aria-label={props.name} class={`${height()} w-full rounded-lg border border-edge bg-black`} /></Match>
    <Match when={kind() === 'audio'}><audio src={props.url} controls aria-label={props.name} class="w-full" /></Match>
    <Match when={kind() === 'text'}><TextPreview source={source()} name={props.name} size={props.size} tall={props.tall} /></Match>
    <Match when={kind() === 'font'}><FontPreview source={source()} name={props.name} /></Match>
    <Match when={kind() === 'model'}><ModelPreview source={source()} title={props.name} /></Match>
  </Switch>;
}

function TextPreview(props: { source: Blob | string; name: string; size: number; tall?: boolean }): JSX.Element {
  const [text] = createResource(() => props.source, (source) => headText(source, TEXT_PREVIEW_BYTES).catch(() => null));
  return <pre aria-label={`Preview of ${props.name}`} class={`${props.tall ? 'max-h-[75vh]' : 'max-h-[28rem]'} overflow-auto rounded-lg border border-code-edge bg-code p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg`}>
    <Show when={!text.loading} fallback={<span class="text-faint">loading preview…</span>}>
      <Show when={text() !== null} fallback={<span class="text-faint">this file could not be read for preview</span>}>
        {text()}{props.size > TEXT_PREVIEW_BYTES ? '\n…' : ''}
      </Show>
    </Show>
  </pre>;
}

function FontPreview(props: { source: Blob | string; name: string }): JSX.Element {
  const family = `mx-preview-${Math.random().toString(36).slice(2, 8)}`;
  const [state, setState] = createSignal<'loading' | 'ready' | 'error'>('loading');
  createEffect(() => {
    if (typeof FontFace === 'undefined') { setState('error'); return; }
    let cancelled = false;
    let face: FontFace | null = null;
    void bytesOf(props.source).then((bytes) => { face = new FontFace(family, bytes); return face.load(); })
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

function DownloadCard(props: { name: string; size: number; url: string; note: string }): JSX.Element {
  const extension = () => extensionOf(props.name);
  const Icon = () => ['gltf', 'obj', 'fbx', 'stl'].includes(extension()) ? Box : extension() === 'xlsx' ? FileSpreadsheet : extension() === 'zip' ? FileArchive : FileIcon;
  return <div aria-label={`File summary of ${props.name}`} class="flex items-center gap-4 rounded-lg border border-edge bg-raised/40 p-5">
    <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface text-accent"><Dynamic component={Icon()} aria-hidden="true" size={26} strokeWidth={1.5} /></span>
    <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-fg">{props.name}</p><p class="mt-0.5 text-xs text-muted">.{extension()} · {formatFileSize(props.size)} · {props.note}</p></div>
    <a href={props.url} download={props.name} aria-label={`Download ${props.name}`} class={`${FILE_ACTION} border-edge-bright text-fg hover:border-accent hover:text-accent`}><Download aria-hidden="true" size={13} />Download</a>
  </div>;
}
