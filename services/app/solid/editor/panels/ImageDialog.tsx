/* @jsxImportSource solid-js */
/**
 * ONE DIALOG FOR PUTTING A PICTURE IN:
 * "Insert image" and "Replace image".
 *
 * Two ways in — a file (dropped on the zone or chosen) or a URL — and both end the same
 * way: the bytes are uploaded or imported as soon as they are chosen (with a visible
 * "Uploading…"), the result is PREVIEWED, and nothing touches the document until the
 * person presses Insert / Replace. A refusal is a sentence in the dialog, next to what
 * caused it. The editor owns the doors (upload, import) and the write; this owns only
 * the choosing.
 *
 * There is no artifact-backend context in the app (see solid/editor/EditPanel.tsx), so this
 * takes `unavailable` as an explicit prop. Whoever wires this dialog into a live page
 * passes `backend.unavailable('webAssets')`.
 */
import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import ImagePlus from 'lucide-solid/icons/image-plus';
import Link2 from 'lucide-solid/icons/link-2';
import X from 'lucide-solid/icons/x';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import { FeatureGate } from '@/solid/components/FeatureGate';
import { rawUrl } from '@/lib/dataflow/ref-data';
import type { ChosenImage, ImageChoice } from '@/lib/artifact-backend/types';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';

export type { ChosenImage, ImageChoice };

/** What the upload door takes (lib/datasets/data-tiers). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const LIMIT_MB = Math.round(DEFAULT_UPLOAD_MAX_BYTES / 1_000_000);
const IMAGE_HINT = `PNG, JPEG, WebP, GIF or SVG · up to ${LIMIT_MB} MB`;

/** An artifact id as the upload door mints it — the only thing a preview is built from. */
const IMAGE_ID = /^[A-Za-z0-9]{6,12}$/;
const FOCUSABLE = 'button:not([disabled]),input:not([disabled])';

export default function ImageDialog(props: {
  mode: 'insert' | 'replace';
  /** Upload a chosen file through the editor's upload door. */
  onUploadFile: (file: File) => Promise<ImageChoice>;
  /** Import a URL through the editor's URL door. */
  onImportUrl: (url: string) => Promise<ImageChoice>;
  /** The person pressed Insert / Replace on what they chose. */
  onConfirm: (image: ChosenImage) => void;
  onClose: () => void;
  /** Backend cannot bring bytes in from outside (offline file). See DEVIATION above. */
  unavailable?: string | null;
}): JSX.Element {
  const title = () => (props.mode === 'insert' ? 'Insert image' : 'Replace image');
  const action = () => (props.mode === 'insert' ? 'Insert' : 'Replace');
  const titleId = createUniqueId();
  const urlReasonId = createUniqueId();
  let panel: HTMLDivElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let chooseFileButton: HTMLButtonElement | undefined;
  const [url, setUrl] = createSignal('');
  const [busy, setBusy] = createSignal<null | 'Uploading…' | 'Importing…'>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [chosen, setChosen] = createSignal<ChosenImage | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const unavailable = () => props.unavailable ?? null;
  /** Answers arriving after a newer choice (or after closing) are dropped. */
  let attempt = 0;
  // Solid sets `autofocus` as a plain attribute; jsdom (and some browsers) never act on it, so
  // the initial focus is set explicitly, so focus lands at mount.
  createDialogShell({ panel: () => panel, onClose: () => props.onClose(), initialFocus: () => chooseFileButton, lockScroll: true, focusable: FOCUSABLE });

  const run = async (label: 'Uploading…' | 'Importing…', obtain: () => Promise<ImageChoice>) => {
    const mine = ++attempt;
    setBusy(label);
    setError(null);
    setChosen(null);
    const result = await obtain().catch((): ImageChoice => ({ ok: false, error: 'Something went wrong. Try again.' }));
    if (mine !== attempt) return;
    setBusy(null);
    // Only an image id the door minted is previewed — and from the server's copy.
    if (result.ok && IMAGE_ID.test(result.image.id)) setChosen(result.image);
    else setError(result.ok ? 'Could not use that image. Try again.' : result.error);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (unavailable()) {
      setChosen(null);
      setError(unavailable());
      return;
    }
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
    void run('Uploading…', () => props.onUploadFile(file));
  };
  const chooseUrl = () => {
    const value = url().trim();
    if (!value) {
      setError('Paste the address of an image first.');
      return;
    }
    void run('Importing…', () => props.onImportUrl(value));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer?.files?.[0]);
  };

  return (
    <div class="fixed inset-0 z-[210] flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        class="w-full max-w-lg rounded-lg border border-edge bg-surface p-4 text-fg shadow-xl"
      >
        <div class="flex items-center justify-between">
          <h2 id={titleId} class="text-sm font-semibold">{title()}</h2>
          <button type="button" aria-label="Close" onClick={props.onClose} class="rounded p-1 text-muted hover:bg-raised hover:text-fg">
            <X size={14} />
          </button>
        </div>

        <section aria-label="Upload" class="mt-3">
          <h3 class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Upload</h3>
          <div
            aria-label="Image drop zone"
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            class={`flex flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-5 text-center ${
              dragging() ? 'border-accent bg-accent-soft' : 'border-edge'
            }`}
          >
            <ImagePlus size={18} class="text-muted" />
            <p class="text-sm">
              Drop an image here or{' '}
              <FeatureGate reason={unavailable()}>
                {(gate) => (
                  <button
                    ref={chooseFileButton}
                    type="button"
                    onClick={() => fileInput?.click()}
                    disabled={gate.disabled}
                    aria-describedby={gate['aria-describedby']}
                    class="cursor-pointer font-medium text-accent underline underline-offset-2 disabled:cursor-default disabled:opacity-50"
                  >
                    choose a file
                  </button>
                )}
              </FeatureGate>
            </p>
            <p class="text-[11px] text-muted">{IMAGE_HINT}</p>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              aria-label="Image file"
              class="hidden"
              onChange={(event) => {
                chooseFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </div>
        </section>

        <section aria-label="From URL" class="mt-4">
          <h3 class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">From URL</h3>
          <div class="flex gap-1.5">
            <div class="relative min-w-0 flex-1">
              <Link2 size={12} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                aria-label="Image URL"
                disabled={!!unavailable()}
                aria-describedby={unavailable() ? urlReasonId : undefined}
                value={url()}
                placeholder="https://…/picture.png"
                onInput={(e) => setUrl(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    chooseUrl();
                  }
                }}
                class="w-full rounded-md border border-edge bg-transparent py-1.5 pl-6 pr-2 text-sm focus:border-edge-bright focus:outline-none"
              />
            </div>
            <FeatureGate reason={unavailable()}>
              {(gate) => (
                <button
                  type="button"
                  aria-label="Import image from URL"
                  onClick={chooseUrl}
                  aria-describedby={gate['aria-describedby']}
                  disabled={gate.disabled || busy() !== null}
                  class="rounded-md border border-edge px-3 text-sm hover:bg-raised disabled:opacity-50"
                >
                  Import
                </button>
              )}
            </FeatureGate>
          </div>
          <Show when={unavailable()}>
            {(reason) => <p id={urlReasonId} class="mt-1.5 text-[11px] text-muted">{reason()}</p>}
          </Show>
        </section>

        <div aria-live="polite" class="mt-4 min-h-[1.25rem]">
          <Show when={busy()}>
            {(label) => (
              <div class="flex items-center gap-2 text-sm text-muted">
                <div role="progressbar" aria-label={label()} class="h-1 w-24 overflow-hidden rounded bg-raised">
                  <div class="h-full w-1/2 animate-pulse rounded bg-accent" />
                </div>
                {label()}
              </div>
            )}
          </Show>
          <Show when={error()}>
            {(message) => <p role="alert" class="text-sm text-red-600">{message()}</p>}
          </Show>
          <Show when={chosen()}>
            {(image) => (
              <figure class="flex justify-center rounded-md bg-raised p-2">
                <img src={rawUrl(image().id, 1)} alt="Preview of the chosen image" class="max-h-48 max-w-full rounded object-contain" />
              </figure>
            )}
          </Show>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} class="rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-raised">
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen() || busy() !== null}
            onClick={() => { const image = chosen(); if (image) props.onConfirm(image); }}
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {action()}
          </button>
        </div>
      </div>
    </div>
  );
}
