'use client';

import {appFetch as fetch} from '@/web/api-origin';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { adoptToken } from '@/lib/browser-session';

/**
 * The human path into the data tier.
 *
 * Reads the file in the browser and posts JSON `{title, dataset: "<csv text>"}`
 * — the same endpoint, shape and auth an agent uses. Deliberately NOT multipart:
 * the app has no `formData()` plumbing anywhere, and inventing it here would add
 * a second upload contract for no gain.
 *
 * What it shows afterwards is the point. An artifact id alone is useless; to
 * write a <Question> you need the `ref:` form and the column names, so both are
 * surfaced and the ref is one click to copy.
 */
/** Rows shown in the preview. Enough to recognise the data, not to browse it. */
const PREVIEW_ROWS = 100;

interface Uploaded {
  id: string;
  title: string | null;
  columns: { name: string; type: string }[];
  rowCount: number | null;
  /** Present only when the source had more rows than we kept. */
  totalRows?: number;
  truncated?: boolean;
}

export default function DatasetUpload({
  frame = true,
}: {
  /** false = no panel chrome and no title, for hosts that already draw both. */
  frame?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Uploaded | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);

  /**
   * Uploading needs a credential and a fresh browser has none — a bare 401 is
   * all it could get. Mint one on demand instead: the same zero-friction deal
   * /api/start gives the agent flow, and the mint binds to the session when
   * there is one, so a logged-in person's data lands in their dashboard.
   */
  const ensureSession = async (): Promise<void> => {
    // Already credentialed? The cookie rides every same-origin request, so a
    // cheap authorized read is the whole test.
    if ((await fetch('/api/my/artifacts')).ok) return;
    const res = await fetch('/api/tokens/anonymous', { method: 'POST' });
    if (!res.ok) {
      // Failing quietly here produced an unauthenticated upload and a generic
      // "Upload failed" — the mint is rate-limited per IP, so say so.
      throw new Error(res.status === 429
        ? 'Too many new sessions from this network. Wait a few minutes, or log in.'
        : 'Could not start a session for the upload.');
    }
    const { token } = await res.json();
    // Straight into the httpOnly cookie: the mint is the only moment this page
    // ever touches the secret, and it does not keep it.
    if (typeof token === 'string' && token) await adoptToken(token);
  };

  const publish = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const res = await fetch('/api/my/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The ingest errors are written for humans ("that sheet is not publicly
        // readable…"), so show them rather than a generic failure.
        setError(data.details?.[0] ?? data.error ?? 'Upload failed.');
        return;
      }
      setResult({ id: data.id, title: data.title ?? null, columns: data.columns ?? [], rowCount: data.rowCount ?? null, totalRows: data.totalRows, truncated: data.truncated });
      // Fetch a preview separately: the create response carries metadata, not
      // rows, and pulling the whole dataset back just to show a corner of it
      // would defeat the point of storing it out of the database.
      setPreview(null);
      if (data.id) {
        try {
          const rows = await (await fetch(`/a/${data.id}/raw`)).json();
          if (Array.isArray(rows)) setPreview(rows.slice(0, PREVIEW_ROWS) as Record<string, unknown>[]);
        } catch { /* the summary above is still useful without a preview */ }
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    // The filename is a real name; the typed one wins if given.
    await publish({ title: name.trim() || file.name.replace(/\.csv$/i, ''), dataset: text });
  };

  /**
   * A sheet URL carries no title, and "Sheet import" tells a reader nothing six
   * months later. Fall back to something identifying — the sheet id — rather
   * than a label that is the same for every import.
   */
  const sheetTitle = () => {
    if (name.trim()) return name.trim();
    const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(sheetUrl)?.[1];
    return id ? `Sheet ${id.slice(0, 8)}` : 'Imported sheet';
  };

  return (
    <div className={frame ? 'rounded-[6px] border border-edge bg-surface p-4' : undefined}>
      {frame && <p className="font-mono text-xs text-fg">Add data</p>}
      <p className="mt-1 font-mono text-xs text-muted">
        A CSV file or a public Google Sheet. You&apos;ll get a reference to use in a chart.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Input
          type="text"
          aria-label="Dataset name"
          placeholder="name (optional — defaults to the file or sheet)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label
          aria-label="Upload a CSV"
          className="cursor-pointer rounded-[4px] border border-dashed border-edge-bright px-3 py-2 text-center font-mono text-xs text-muted hover:text-accent"
        >
          {busy ? 'uploading…' : 'choose a CSV file'}
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void publish({ title: sheetTitle(), sheetUrl });
          }}
        >
          <Input
            type="url"
            aria-label="Google Sheet URL"
            placeholder="or paste a public Google Sheet link"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
          />
          <Button type="submit" aria-label="Import sheet" disabled={busy || sheetUrl.length === 0}>
            import
          </Button>
        </form>
      </div>

      {error && <p className="mt-3 font-mono text-xs text-danger" aria-label="Upload error">{error}</p>}

      {result && (
        <div className="mt-3 rounded-[4px] border border-edge bg-raised p-3" aria-label="Uploaded dataset">
          <p className="font-mono text-xs text-fg">
            {result.title ?? 'dataset'}
            {result.rowCount !== null && <span className="text-muted"> · {result.rowCount} rows</span>}
          </p>
          <button
            type="button"
            aria-label="Copy dataset reference"
            className="mt-2 w-full cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-left font-mono text-xs text-accent hover:bg-surface"
            onClick={() => {
              void navigator.clipboard?.writeText(`ref:${result.id}`);
              setCopied(true);
            }}
          >
            ref:{result.id} {copied && <span className="text-muted">copied</span>}
          </button>
          {result.truncated && (
            <p className="mt-2 font-mono text-xs text-muted" aria-label="Truncation notice">
              Kept the first {result.rowCount?.toLocaleString()} of {result.totalRows?.toLocaleString()} rows.
            </p>
          )}

          {preview && preview.length > 0 && (
            <div className="mt-3" aria-label="Dataset preview">
              {/* Its own scroll container: a wide table must never make the page
                  scroll sideways (the surface width contract). */}
              <div className="max-h-72 overflow-auto rounded-[4px] border border-edge">
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c.name} className="border-b border-edge px-2 py-1 text-left font-medium text-fg whitespace-nowrap">
                          {c.name}
                          <span className="ml-1 font-normal text-faint">{c.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="odd:bg-raised/40">
                        {result.columns.map((c) => (
                          <td key={c.name} className="border-b border-edge px-2 py-1 text-muted whitespace-nowrap">
                            {/* null is MISSING, and must not look like the text "null". */}
                            {row[c.name] === null || row[c.name] === undefined
                              ? <span className="text-faint">—</span>
                              : String(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 font-mono text-[11px] text-faint" aria-label="Preview notice">
                Previewing {preview.length} of {result.rowCount?.toLocaleString()} stored rows.
              </p>
            </div>
          )}
          {result.columns.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-muted" aria-label="Dataset columns">
              {result.columns.map((c) => `${c.name}:${c.type}`).join('  ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
