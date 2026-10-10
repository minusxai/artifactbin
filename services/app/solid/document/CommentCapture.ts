import { createSignal, onCleanup } from 'solid-js';
import { beginCapture } from '@/lib/capture/screen';
import { CaptureError, type CaptureStartResult, type CaptureSession, type CapturedImage, type CaptureRect } from '@/lib/capture/contract';
import { COMMENT_IMAGE_LIMITS, type BrushStroke, type CommentImageMetadata } from '../../../contracts/src/comment-image';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';

/** What the server stores (lib/annotations/comment-images decodes exactly these). */
export const COMMENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const TYPE_MESSAGE = 'Attach a PNG, JPEG or WebP image.';
const SIZE_MESSAGE = `This image is larger than ${Math.round(COMMENT_IMAGE_LIMITS.bytes / 1_000_000)} MB.`;

interface Draft { image: CapturedImage; preview: Blob; strokes: BrushStroke[]; editId: string }
const messages: Record<string, string> = {
  unsupported: 'This browser cannot verify capture of this tab. Upload a screenshot, or explicitly continue without one.',
  cancelled: 'Screen sharing was cancelled. Retry, upload a screenshot, or continue without one.',
  'wrong-source': 'Choose this browser tab when sharing. The other source was stopped.',
  geometry: 'The page moved during capture. Retake the screenshot.',
  ended: 'Screen sharing ended. Retake the screenshot.',
  timeout: 'Capture timed out. Please retry.',
};

/**
 * lib/capture/use-comment-capture in SOLID. Screenshot permission and the staged image stay private
 * to one comment draft; the document revision is read LIVE (`editId` as an accessor), so an edit
 * that lands while the capture is in flight fails it as moved geometry rather than attaching a
 * picture of a document that no longer exists.
 */
export function createCommentCapture(backend: ArtifactBackend, editId?: string | (() => string | undefined)) {
  const revision = typeof editId === 'function' ? editId : () => editId;
  let session: CaptureSession | null = null;
  let generation = 0;
  let staged: { draft: Draft; preview: Blob; id: string; editId: string } | null = null;
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [required, setRequired] = createSignal(false);
  const [error, setError] = createSignal('');
  const reset = () => {
    generation += 1; session?.dispose(); session = null; staged = null;
    setDraft(null); setBusy(false); setRequired(false); setError('');
  };
  onCleanup(reset);
  const available = () => Boolean(revision() && !backend.unavailable('commentImages'));
  const start = async (): Promise<CaptureStartResult> => {
    reset();
    if (!available()) return 'unavailable';
    const mine = generation;
    setRequired(true); setBusy(true);
    try {
      const next = await beginCapture();
      if (mine !== generation) { next.dispose(); return 'superseded'; }
      session = next;
      return 'ready';
    } catch (cause) {
      if (mine !== generation) return 'superseded';
      if (cause instanceof CaptureError && cause.code === 'cancelled') { reset(); return 'cancelled'; }
      setError(messages[cause instanceof CaptureError ? cause.code : 'unsupported']);
      return 'unavailable';
    } finally { if (mine === generation) setBusy(false); }
  };
  const capture = async (rect: CaptureRect) => {
    if (!available()) return;
    setRequired(true);
    const current = session;
    if (!current) { setError(value => value || messages.unsupported); return; }
    const mine = generation;
    const capturedEditId = revision()!;
    setBusy(true);
    const started = performance.now();
    // Selection chrome is not part of the image; the class is removed on every exit path.
    document.documentElement.classList.add('mx-taking-screenshot');
    try {
      const image = await current.capture(rect);
      if (mine !== generation) return;
      if (revision() !== capturedEditId) throw new CaptureError('geometry');
      setDraft({ image, preview: image.blob, strokes: [], editId: capturedEditId }); setError('');
    } catch (cause) {
      if (mine === generation) setError(messages[cause instanceof CaptureError ? cause.code : 'unsupported']);
    } finally {
      try { performance.measure('comment-screenshot:capture', { start: started, end: performance.now() }); } catch { /* measurement is optional */ }
      if (session === current) session = null;
      current.dispose(); document.documentElement.classList.remove('mx-taking-screenshot');
      if (mine === generation) setBusy(false);
    }
  };
  const upload = async (file: File) => {
    if (!available()) return;
    const mine = ++generation;
    session?.dispose(); session = null; setBusy(true); setError('');
    try {
      if (!(COMMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error(TYPE_MESSAGE);
      if (file.size > COMMENT_IMAGE_LIMITS.bytes) throw new Error(SIZE_MESSAGE);
      const bitmap = await createImageBitmap(file);
      try {
        // Larger pictures are scaled into the stored bounds rather than refused: a Retina screenshot is the common case.
        const scale = Math.min(1, COMMENT_IMAGE_LIMITS.edge / Math.max(bitmap.width, bitmap.height), Math.sqrt(COMMENT_IMAGE_LIMITS.pixels / (bitmap.width * bitmap.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not read this image.');
        const image: CapturedImage = { blob, width: canvas.width, height: canvas.height, rect: { x: 0, y: 0, width: canvas.width, height: canvas.height }, viewport: { width: canvas.width, height: canvas.height }, method: 'upload', capturedAt: new Date().toISOString() };
        if (mine === generation) { setDraft({ image, preview: blob, strokes: [], editId: revision()! }); setRequired(true); }
      } finally { bitmap.close(); }
    } catch (cause) { if (mine === generation) setError(cause instanceof Error ? cause.message : 'Could not read this image.'); }
    finally { if (mine === generation) setBusy(false); }
  };
  /**
   * Upload the draft as drawn, once per drawing and revision. A captured screenshot is a picture of the
   * revision it was taken at; an attached image is of no revision, so it is staged against the CURRENT one.
   */
  const stage = async (drawing?: { preview: Blob; strokes: BrushStroke[] }): Promise<{ id: string; editId: string } | undefined> => {
    const current = draft();
    if (!current) return undefined;
    const preview = drawing?.preview ?? current.preview;
    const editId = current.image.method === 'upload' ? revision() ?? current.editId : current.editId;
    if (staged?.draft === current && staged.preview === preview && staged.editId === editId) return { id: staged.id, editId };
    const metadata: CommentImageMetadata = { v: 1, capturedEditId: editId, capturedAt: current.image.capturedAt, method: current.image.method, width: current.image.width, height: current.image.height, rect: current.image.rect, viewport: current.image.viewport, strokes: drawing?.strokes ?? current.strokes };
    const form = new FormData();
    form.set('original', current.image.blob, 'original.png'); form.set('preview', preview, 'preview.png');
    form.set('metadata', JSON.stringify(metadata));
    const result = await backend.uploadCommentImage(form);
    staged = { draft: current, preview, id: result.id, editId };
    return { id: result.id, editId };
  };
  /** The server refused the stage (used, expired, another revision): the next send uploads afresh. */
  const unstage = () => { staged = null; };
  return { draft, busy, required, error, reset, start, capture, upload, stage, unstage, skip: reset };
}
