/* @jsxImportSource solid-js */
/** A separate kit family: upload UI and page bindings load only on pages using FileUpload. */
import { For, Show, createEffect, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { DEFAULT_UPLOAD_MAX_BYTES, type DatasetUploadResult } from '@artifactbin/contracts';
import { refName } from '@/lib/story/data/dataflow';
import { bindPage } from '@/lib/story-runtime/page-bindings';
import { useIsland } from '../../context';

type Props = Record<string, unknown>;
type Failed = { file: File; error: string };
const text = (value: unknown) => typeof value === 'string' ? value : '';
function refs(value: unknown, multiple: boolean): string[] {
  if (!multiple) return typeof value === 'string' && value ? [value] : [];
  try { const parsed: unknown = JSON.parse(text(value)); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
}
/** Browser guidance only; the dataset door independently validates the bytes and content type. */
function accepted(file: File, accept: string): boolean {
  const rules = accept.toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
  return !rules.length || rules.some(rule => rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : rule.endsWith('/*') ? file.type.toLowerCase().startsWith(rule.slice(0,-1)) : file.type.toLowerCase() === rule);
}
const buttonClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
export function FileUpload(p: Props) {
  const island = useIsland();
  const name = () => refName(text(p.value));
  const busyName = () => { const n = refName(text(p.busy)); return n && island.valueType(n) === 'boolean' ? n : null; };
  const multiple = () => p.multiple === true;
  const current = () => { const n = name(); return n ? island.value(n) : p.value; };
  const selected = () => refs(current(), multiple());
  const binding = () => bindPage(island.store());
  const [uploading, setUploading] = createSignal(false);
  const [failures, setFailures] = createSignal<Failed[]>([]);
  const [error, setError] = createSignal('');
  const [metadata, setMetadata] = createSignal<Record<string, DatasetUploadResult>>({});
  const [brokenImages, setBrokenImages] = createSignal<Set<string>>(new Set());
  const label = () => text(p.label) || 'Attachments';
  const unavailable = () => island.writesUnavailable() || (!island.viewer() ? 'Sign in to upload files.' : '') || (!name() || island.valueType(name()!) !== 'string' || !island.store() ? 'Bind a declared string Value to upload files.' : '') || (p.disabled === true ? 'Uploads are disabled.' : '');
  let generation = 0, disposed = false;
  let expected: unknown = untrack(current);
  let input!: HTMLInputElement;
  const busy = (value: boolean) => { setUploading(value); const n = busyName(); if (n) island.setValue(n, value); };
  // A parent resetting the form invalidates every pending completion; own writes update expected first.
  createEffect(() => { const value = current(); if (value !== expected) { expected = value; generation++; setFailures([]); setError(''); busy(false); } });
  onCleanup(() => { disposed = true; generation++; const n = busyName(); if (n) island.setValue(n, false); });
  const write = (next: string[]) => { const n = name(); if (!n) return; expected = multiple() ? JSON.stringify(next) : next[0] ?? null; island.setValue(n, expected as string | null); };
  const url = (ref: string) => binding().fileUrl(text(p.dataset), ref);
  const filename = (ref: string) => metadata()[ref]?.name ?? ref;
  async function upload(files: File[], retained: Failed[] = []) {
    if (unavailable() || uploading() || !files.length) return;
    setError('');
    const maxFiles = multiple() ? typeof p.maxFiles === 'number' && Number.isFinite(p.maxFiles) ? Math.max(1, Math.floor(p.maxFiles)) : 10 : 1;
    if (files.length + (multiple() ? selected().length : 0) > maxFiles) { setError(`Choose at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`); return; }
    for (const file of files) {
      if (file.size > DEFAULT_UPLOAD_MAX_BYTES) { setError(`${file.name} exceeds the ${DEFAULT_UPLOAD_MAX_BYTES / 1_000_000} MB limit.`); return; }
      if (!accepted(file, text(p.accept))) { setError(`${file.name} is not an accepted file type.`); return; }
    }
    const token = ++generation;
    const dataset = text(p.dataset), store = island.store();
    setFailures(retained); busy(true);
    const stillCurrent = () => !disposed && token === generation && island.store() === store && text(p.dataset) === dataset && !unavailable();
    for (const file of files) {
      if (!stillCurrent()) break;
      try {
        const result = await binding().upload(dataset, file);
        if (!stillCurrent()) break;
        setMetadata(previous => ({ ...previous, [result.ref]: result }));
        write(multiple() ? [...new Set([...selected(), result.ref])] : [result.ref]);
      } catch (cause) {
        if (!stillCurrent()) break;
        setFailures(previous => [...previous, { file, error: cause instanceof Error ? cause.message : 'Upload failed. Try again.' }]);
      }
    }
    if (!disposed && token === generation) busy(false);
  }
  const remove = (ref: string) => { generation++; setFailures([]); busy(false); write(selected().filter(value => value !== ref)); };
  const rest = () => Object.fromEntries(Object.entries(p).filter(([key]) => !['dataset','value','multiple','accept','label','busy','maxFiles','disabled','children','className'].includes(key))) as JSX.HTMLAttributes<HTMLDivElement>;
  return <div {...rest()} data-slot="file-upload" class={text(p.class) || ['mx-control flex flex-col gap-3', text(p.className)].filter(Boolean).join(' ')} aria-busy={uploading()}>
    <span class="text-sm font-medium">{label()}</span>
    <div class="flex flex-col items-start gap-2 rounded-md border border-dashed border-input p-4" onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); void upload(Array.from(event.dataTransfer?.files ?? [])); }}>
      <input ref={input} type="file" aria-label={`Choose ${label()}`} accept={text(p.accept) || undefined} multiple={multiple()} disabled={!!unavailable() || uploading()} class="sr-only" tabindex={-1}
        onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void upload(files); }} />
      <button type="button" aria-label={`Choose ${label()}`} class={buttonClass} disabled={!!unavailable() || uploading()} onClick={() => input.click()}>Choose {multiple() ? 'files' : 'file'}</button>
      <span class="text-xs text-muted-foreground">{unavailable() || `Or drop ${multiple() ? 'files' : 'a file'} here. Up to ${DEFAULT_UPLOAD_MAX_BYTES / 1_000_000} MB per file.`}</span>
      <Show when={uploading()}><span role="status" class="flex items-center gap-2 text-sm"><progress aria-label="Uploading files" class="w-24" />Uploading…</span></Show>
    </div>
    <Show when={error()}><p role="alert" class="text-sm text-destructive">{error()}</p></Show>
    <For each={failures()}>{failure => <div class="flex items-center gap-2 text-sm"><span role="alert" class="text-destructive">{failure.file.name}: {failure.error}</span><button type="button" class={buttonClass} aria-label={`Retry ${failure.file.name}`} disabled={!!unavailable() || uploading()} onClick={() => { const others = failures().filter(item => item !== failure); void upload([failure.file], others); }}>Retry</button></div>}</For>
    <ul aria-label={`${label()} files`} class="m-0 flex list-none flex-col gap-2 p-0"><For each={selected()}>{ref => <li class="flex items-center gap-3 rounded-md border border-border p-2">
      <Show when={!brokenImages().has(ref) && (!metadata()[ref] || metadata()[ref]!.contentType.startsWith('image/'))}><img src={url(ref)} alt={filename(ref)} loading="lazy" class="size-16 rounded-sm object-cover" onError={() => setBrokenImages(previous => new Set([...previous, ref]))} /></Show>
      <div class="min-w-0 flex-1"><a href={url(ref)} download={filename(ref)} class="block truncate text-sm underline">{filename(ref)}</a><Show when={metadata()[ref]}>{result => <span class="text-xs text-muted-foreground">{result().size < 1000 ? `${result().size} bytes` : `${(result().size / 1_000_000).toFixed(2)} MB`}</span>}</Show></div>
      <button type="button" aria-label={`Remove ${filename(ref)}`} class={buttonClass} disabled={!!unavailable()} onClick={() => remove(ref)}>Remove</button>
    </li>}</For></ul>
  </div>;
}
