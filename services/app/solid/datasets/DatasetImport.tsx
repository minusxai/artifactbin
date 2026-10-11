/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show } from 'solid-js';
import { MAX_DATASET_BYTES, type DatasetSource, type IngestResult } from '@/lib/data-ingest/types';
import { apiRequest } from '../lib/api';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';

/** Imports rows into a draft; the editor owns table naming and the eventual save. */
export function DatasetImport(props: {
  source: 'csv' | 'sheet';
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onImported: (rows: IngestResult['rows'], suggestedName: string) => void;
}) {
  const [sheetUrl, setSheetUrl] = createSignal('');
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [importing, setImporting] = createSignal(false);
  createEffect(() => { props.source; setError(''); setNotice(''); });
  const run = async (source: () => Promise<DatasetSource>, name: string) => {
    if (props.disabled || importing()) return;
    setImporting(true); props.onBusyChange(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<IngestResult>('/api/my/datasets/import', 'POST', await source());
      props.onImported(result.rows, name);
      setNotice(result.truncated
        ? `Imported ${result.rowCount.toLocaleString()} of ${result.totalRows.toLocaleString()} rows. The remaining rows exceed the dataset limit.`
        : `Imported ${result.rowCount.toLocaleString()} rows. Review the table below before saving.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import data.');
    } finally {
      setImporting(false); props.onBusyChange(false);
    }
  };
  return <div class="space-y-3" aria-label="Import data">
    <Show when={props.source === 'csv'}>
    <p class="text-xs text-muted">Upload a CSV file with column names in the first row.</p>
    <Field label="CSV file">
      <Input type="file" accept=".csv,text/csv" aria-label="CSV file" disabled={props.disabled}
        class="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:font-medium file:text-fg" onChange={event => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file) void run(async () => {
            if (file.size > MAX_DATASET_BYTES) throw new Error(`The CSV file exceeds the ${MAX_DATASET_BYTES / 1024 / 1024} MB limit.`);
            return { kind: 'csv', text: await file.text() };
          }, file.name.replace(/\.csv$/i, '')).finally(() => { input.value = ''; });
        }} />
    </Field>
    </Show>
    <Show when={props.source === 'sheet'}>
    <div class="flex flex-wrap items-end gap-2">
      <Field label="Public Google Sheet" class="min-w-0 flex-1">
        <Input type="url" aria-label="Google Sheet URL" placeholder="https://docs.google.com/spreadsheets/d/…" disabled={props.disabled} value={sheetUrl()} onInput={event => setSheetUrl(event.currentTarget.value)} />
      </Field>
      <Button aria-label="Import sheet" disabled={props.disabled || !sheetUrl().trim()} onClick={() => void run(async () => ({ kind: 'sheetUrl', url: sheetUrl().trim() }), 'sheet')}>Import sheet</Button>
    </div>
    <p class="text-xs text-muted">Imports a snapshot of the rows. Google Sheets must be shared so anyone with the link can view.</p>
    </Show>
    <Show when={importing()}><StatusMessage kind="loading">Importing rows…</StatusMessage></Show>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <Show when={notice()}><StatusMessage kind="notice">{notice()}</StatusMessage></Show>
  </div>;
}
