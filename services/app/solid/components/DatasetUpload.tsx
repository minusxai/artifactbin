/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { apiFetch } from '../lib/api';

interface Uploaded { id: string; title: string | null; columns: { name: string; type: string }[]; rowCount: number | null; totalRows?: number; truncated?: boolean }

export function DatasetUpload(): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<Uploaded | null>(null);
  const [sheetUrl, setSheetUrl] = createSignal('');
  const [name, setName] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [preview, setPreview] = createSignal<Record<string, unknown>[] | null>(null);
  const publish = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/my/artifacts', 'POST', body);
      const data = await response.json().catch(() => ({})) as Uploaded & { details?: string[]; error?: string };
      if (!response.ok) { setError(data.details?.[0] ?? data.error ?? 'Upload failed.'); return; }
      setResult({ id: data.id, title: data.title ?? null, columns: data.columns ?? [], rowCount: data.rowCount ?? null, totalRows: data.totalRows, truncated: data.truncated });
      setPreview(null);
      if (data.id) { try { const rows = await (await fetch(`/a/${data.id}/raw`)).json(); if (Array.isArray(rows)) setPreview(rows.slice(0, 100) as Record<string, unknown>[]); } catch { /* summary stays useful */ } }
    } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : 'Could not reach the server.'); }
    finally { setBusy(false); }
  };
  const onFile = async (file: File) => publish({ title: name().trim() || file.name.replace(/\.csv$/i, ''), dataset: await file.text() });
  const sheetTitle = () => { if (name().trim()) return name().trim(); const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(sheetUrl())?.[1]; return id ? `Sheet ${id.slice(0, 8)}` : 'Imported sheet'; };
  return <div class="rounded-[6px] border border-edge bg-surface p-4"><p class="font-mono text-xs text-fg">Add data</p><p class="mt-1 font-mono text-xs text-muted">A CSV file or a public Google Sheet. You’ll get a reference to use in a chart.</p>
    <div class="mt-3 flex flex-col gap-2"><input type="text" aria-label="Dataset name" placeholder="name (optional — defaults to the file or sheet)" value={name()} onInput={event => setName(event.currentTarget.value)} class="rounded-[4px] border border-edge bg-surface px-3 py-2 text-sm" />
      <label aria-label="Upload a CSV" class="cursor-pointer rounded-[4px] border border-dashed border-edge-bright px-3 py-2 text-center font-mono text-xs text-muted hover:text-accent">{busy() ? 'uploading…' : 'choose a CSV file'}<input type="file" accept=".csv,text/csv" aria-label="CSV file" class="hidden" disabled={busy()} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void onFile(file); }} /></label>
      <form class="flex gap-2" onSubmit={event => { event.preventDefault(); void publish({ title: sheetTitle(), sheetUrl: sheetUrl() }); }}><input type="url" aria-label="Google Sheet URL" placeholder="or paste a public Google Sheet link" value={sheetUrl()} onInput={event => setSheetUrl(event.currentTarget.value)} class="min-w-0 flex-1 rounded-[4px] border border-edge bg-surface px-3 py-2 text-sm" /><button type="submit" aria-label="Import sheet" disabled={busy() || !sheetUrl()} class="rounded-[4px] border border-fg bg-fg px-3 py-1.5 font-mono text-xs text-bg">import</button></form>
    </div>
    <Show when={error()}><p class="mt-3 font-mono text-xs text-danger" aria-label="Upload error">{error()}</p></Show>
    <Show when={result()}>{uploaded => <div class="mt-3 rounded-[4px] border border-edge bg-raised p-3" aria-label="Uploaded dataset"><p class="font-mono text-xs text-fg">{uploaded().title ?? 'dataset'}<Show when={uploaded().rowCount !== null}><span class="text-muted"> · {uploaded().rowCount} rows</span></Show></p><button type="button" aria-label="Copy dataset reference" class="mt-2 w-full rounded-[4px] border border-edge px-2 py-1 text-left font-mono text-xs text-accent" onClick={() => { void navigator.clipboard?.writeText(`ref:${uploaded().id}`); setCopied(true); }}>ref:{uploaded().id} <Show when={copied()}><span class="text-muted">copied</span></Show></button>
      <Show when={uploaded().truncated}><p class="mt-2 font-mono text-xs text-muted" aria-label="Truncation notice">Kept the first {uploaded().rowCount?.toLocaleString()} of {uploaded().totalRows?.toLocaleString()} rows.</p></Show>
      <Show when={preview()?.length}><div class="mt-3" aria-label="Dataset preview"><div class="max-h-72 overflow-auto rounded-[4px] border border-edge"><table class="w-full border-collapse font-mono text-[11px]"><thead class="sticky top-0 bg-surface"><tr><For each={uploaded().columns}>{column => <th class="border-b border-edge px-2 py-1 text-left font-medium text-fg whitespace-nowrap">{column.name}<span class="ml-1 font-normal text-faint">{column.type}</span></th>}</For></tr></thead><tbody><For each={preview()}>{row => <tr class="odd:bg-raised/40"><For each={uploaded().columns}>{column => <td class="border-b border-edge px-2 py-1 text-muted whitespace-nowrap">{row[column.name] == null ? '—' : String(row[column.name])}</td>}</For></tr>}</For></tbody></table></div><p class="mt-1 font-mono text-[11px] text-faint" aria-label="Preview notice">Previewing {preview()?.length} of {uploaded().rowCount?.toLocaleString()} stored rows.</p></div></Show>
      <Show when={uploaded().columns.length}><p class="mt-2 font-mono text-[11px] text-muted" aria-label="Dataset columns">{uploaded().columns.map(column => `${column.name}:${column.type}`).join('  ')}</p></Show>
    </div>}</Show>
  </div>;
}
