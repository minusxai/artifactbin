import { createSignal, onCleanup } from 'solid-js';
import { beginCapture } from '@/lib/capture/screen';
import { CaptureError, type CaptureSession, type CapturedImage, type CaptureRect } from '@/lib/capture/contract';
import type { BrushStroke, CommentImageMetadata } from '../../../contracts/src/comment-image';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';

interface Draft { image: CapturedImage; preview: Blob; strokes: BrushStroke[]; editId: string }
const messages: Record<string, string> = {
  unsupported: 'This browser cannot verify capture of this tab. Upload a screenshot, or explicitly continue without one.',
  cancelled: 'Screen sharing was cancelled. Retry, upload a screenshot, or continue without one.',
  'wrong-source': 'Choose this browser tab when sharing. The other source was stopped.',
  geometry: 'The page moved during capture. Retake the screenshot.',
  ended: 'Screen sharing ended. Retake the screenshot.',
  timeout: 'Capture timed out. Please retry.',
};

/** Screenshot permission and staged image remain private to a single comment draft. */
export function createCommentCapture(backend: ArtifactBackend, editId?: string) {
  let session: CaptureSession | null = null;
  let generation = 0;
  let staged: { draft: Draft; preview: Blob; id: string } | null = null;
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [required, setRequired] = createSignal(false);
  const [error, setError] = createSignal('');
  const reset = () => {
    generation += 1; session?.dispose(); session = null; staged = null;
    setDraft(null); setBusy(false); setRequired(false); setError('');
  };
  onCleanup(reset);
  const available = () => Boolean(editId && !backend.unavailable('commentImages'));
  const start = async () => {
    reset();
    if (!available()) return true;
    const mine = generation;
    setRequired(true); setBusy(true);
    try {
      const pending = beginCapture();
      const next = await pending;
      if (mine !== generation) { next.dispose(); return false; }
      session = next;
    } catch (cause) {
      if (mine === generation) setError(messages[cause instanceof CaptureError ? cause.code : 'unsupported']);
    } finally { if (mine === generation) setBusy(false); }
    return mine === generation;
  };
  const capture = async (rect: CaptureRect) => {
    if (!available()) return;
    setRequired(true);
    const current = session; session = null;
    if (!current) { setError(value => value || messages.unsupported); return; }
    const mine = generation;
    setBusy(true);
    document.documentElement.classList.add('mx-taking-screenshot');
    try {
      const image = await current.capture(rect);
      if (mine === generation) { setDraft({ image, preview: image.blob, strokes: [], editId: editId! }); setError(''); }
    } catch (cause) {
      if (mine === generation) setError(messages[cause instanceof CaptureError ? cause.code : 'unsupported']);
    } finally {
      current.dispose(); document.documentElement.classList.remove('mx-taking-screenshot');
      if (mine === generation) setBusy(false);
    }
  };
  const upload = async (file: File) => {
    if (!available()) return;
    const mine = ++generation;
    session?.dispose(); session = null; setBusy(true); setError('');
    try {
      if (file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG or WebP up to 8 MB.');
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height), Math.sqrt(4000000 / (bitmap.width * bitmap.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not read this image.');
        const image: CapturedImage = { blob, width: canvas.width, height: canvas.height, rect: { x: 0, y: 0, width: canvas.width, height: canvas.height }, viewport: { width: canvas.width, height: canvas.height }, method: 'upload', capturedAt: new Date().toISOString() };
        if (mine === generation) { setDraft({ image, preview: blob, strokes: [], editId: editId! }); setRequired(true); }
      } finally { bitmap.close(); }
    } catch (cause) { if (mine === generation) setError(cause instanceof Error ? cause.message : 'Could not read this image.'); }
    finally { if (mine === generation) setBusy(false); }
  };
  const stage = async (drawing?: { preview: Blob; strokes: BrushStroke[] }) => {
    const current = draft();
    if (!current) return undefined;
    const preview = drawing?.preview ?? current.preview;
    if (staged?.draft === current && staged.preview === preview) return staged.id;
    const metadata: CommentImageMetadata = { v: 1, capturedEditId: current.editId, capturedAt: current.image.capturedAt, method: current.image.method, width: current.image.width, height: current.image.height, rect: current.image.rect, viewport: current.image.viewport, strokes: drawing?.strokes ?? current.strokes };
    const form = new FormData();
    form.set('original', current.image.blob, 'original.png'); form.set('preview', preview, 'preview.png');
    form.set('metadata', JSON.stringify(metadata));
    const result = await backend.uploadCommentImage(form);
    staged = { draft: current, preview, id: result.id };
    return result.id;
  };
  return { draft, busy, required, error, reset, start, capture, upload, stage, skip: reset };
}
