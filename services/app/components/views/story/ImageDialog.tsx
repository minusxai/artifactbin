'use client';

/**
 * ONE DIALOG FOR PUTTING A PICTURE IN: "Insert image" and "Replace image".
 *
 * Two ways in — a file (dropped on the zone or chosen) or a URL — and both
 * end the same way: the bytes are uploaded or imported as soon as they are
 * chosen (with a visible "Uploading…"), the result is PREVIEWED, and nothing
 * touches the document until the person presses Insert / Replace. A refusal
 * is a sentence in the dialog, next to what caused it. The editor owns the
 * doors (upload, import) and the write; this owns only the choosing.
 */
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Link2, X } from 'lucide-react';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import { useDialogKeyboard } from '@/components/use-dialog-keyboard';
import { imageRawUrl } from '@/lib/story/ref-data';

/** What the upload door takes (lib/story/data-tiers). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const LIMIT_MB = Math.round(DEFAULT_UPLOAD_MAX_BYTES / 1_000_000);
export const IMAGE_HINT = `PNG, JPEG, WebP, GIF or SVG · up to ${LIMIT_MB} MB`;

export interface ChosenImage {
  id: string;
  rawUrl?: string;
}
export type ImageChoice = { ok: true; image: ChosenImage } | { ok: false; error: string };

/** An artifact id as the upload door mints it — the only thing a preview is built from. */
const IMAGE_ID = /^[A-Za-z0-9]{6,12}$/;
const FOCUSABLE = 'button:not([disabled]),input:not([disabled])';

export default function ImageDialog({
  mode,
  onUploadFile,
  onImportUrl,
  onConfirm,
  onClose,
}: {
  mode: 'insert' | 'replace';
  /** Upload a chosen file through the editor's upload door. */
  onUploadFile: (file: File) => Promise<ImageChoice>;
  /** Import a URL through the editor's URL door. */
  onImportUrl: (url: string) => Promise<ImageChoice>;
  /** The person pressed Insert / Replace on what they chose. */
  onConfirm: (image: ChosenImage) => void;
  onClose: () => void;
}) {
  const title = mode === 'insert' ? 'Insert image' : 'Replace image';
  const action = mode === 'insert' ? 'Insert' : 'Replace';
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<null | 'Uploading…' | 'Importing…'>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenImage | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Answers arriving after a newer choice (or after closing) are dropped. */
  const attempt = useRef(0);
  useDialogKeyboard(panel, onClose, FOCUSABLE);
  useEffect(() => () => void (attempt.current = -1), []);

  const run = async (label: 'Uploading…' | 'Importing…', obtain: () => Promise<ImageChoice>) => {
    const mine = ++attempt.current;
    setBusy(label);
    setError(null);
    setChosen(null);
    const result = await obtain().catch((): ImageChoice => ({ ok: false, error: 'Something went wrong. Try again.' }));
    if (mine !== attempt.current) return;
    setBusy(null);
    // Only an image id the door minted is previewed — and from the server's copy.
    if (result.ok && IMAGE_ID.test(result.image.id)) setChosen(result.image);
    else setError(result.ok ? 'Could not use that image. Try again.' : result.error);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      setChosen(null);
      setError(`That file is not an image this can use. ${IMAGE_HINT}.`);
      return;
    }
    if (file.size > DEFAULT_UPLOAD_MAX_BYTES) {
      setChosen(null);
      setError(`That image is larger than ${LIMIT_MB} MB.`);
      return;
    }
    void run('Uploading…', () => onUploadFile(file));
  };
  const chooseUrl = () => {
    const value = url.trim();
    if (!value) {
      setError('Paste the address of an image first.');
      return;
    }
    void run('Importing…', () => onImportUrl(value));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-lg border border-edge bg-surface p-4 text-fg shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-raised hover:text-fg">
            <X size={14} />
          </button>
        </div>

        <section aria-label="Upload" className="mt-3">
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Upload</h3>
          <div
            aria-label="Image drop zone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-5 text-center ${
              dragging ? 'border-accent bg-accent-soft' : 'border-edge'
            }`}
          >
            <ImagePlus size={18} className="text-muted" />
            <p className="text-sm">
              Drop an image here or{' '}
              <button
                type="button"
                autoFocus
                onClick={() => fileInput.current?.click()}
                className="cursor-pointer font-medium text-accent underline underline-offset-2"
              >
                choose a file
              </button>
            </p>
            <p className="text-[11px] text-muted">{IMAGE_HINT}</p>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              aria-label="Image file"
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section aria-label="From URL" className="mt-4">
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">From URL</h3>
          <div className="flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Link2 size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                aria-label="Image URL"
                value={url}
                placeholder="https://…/picture.png"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    chooseUrl();
                  }
                }}
                className="w-full rounded-md border border-edge bg-transparent py-1.5 pl-6 pr-2 text-sm focus:border-edge-bright focus:outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="Import image from URL"
              onClick={chooseUrl}
              disabled={busy !== null}
              className="rounded-md border border-edge px-3 text-sm hover:bg-raised disabled:opacity-50"
            >
              Import
            </button>
          </div>
        </section>

        <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <div role="progressbar" aria-label={busy} className="h-1 w-24 overflow-hidden rounded bg-raised">
                <div className="h-full w-1/2 animate-pulse rounded bg-accent" />
              </div>
              {busy}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {chosen && (
            <figure className="flex justify-center rounded-md bg-raised p-2">
              <img src={imageRawUrl(chosen.id, 1)} alt="Preview of the chosen image" className="max-h-48 max-w-full rounded object-contain" />
            </figure>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-raised">
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen || busy !== null}
            onClick={() => chosen && onConfirm(chosen)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
