import { expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createCommentCapture } from '../CommentCapture';

vi.mock('@/lib/capture/screen', () => ({
  beginCapture: vi.fn(async () => ({
    dispose: vi.fn(),
    capture: vi.fn(async (rect: { x: number; y: number; width: number; height: number }) => ({
      blob: new Blob(['image'], { type: 'image/png' }), width: 40, height: 30,
      rect, viewport: { width: 800, height: 600 }, method: 'canvas',
      capturedAt: '2026-09-29T12:00:00.000Z',
    })),
  })),
}));

it('stages a captured image with the captured edit revision and reuses the stage on retry', async () => {
  const upload = vi.fn(async (_form: FormData) => ({ id: 'stage-1' }));
  const backend = { unavailable: vi.fn(() => null), uploadCommentImage: upload } as unknown as ArtifactBackend;
  let dispose!: () => void;
  const capture = createRoot(rootDispose => { dispose = rootDispose; return createCommentCapture(backend, 'edit-1'); });
  await capture.start();
  await capture.capture({ x: 1, y: 2, width: 40, height: 30 });
  expect(capture.required()).toBe(true);
  expect(capture.draft()).toBeTruthy();
  expect(await capture.stage()).toBe('stage-1');
  expect(await capture.stage()).toBe('stage-1');
  expect(upload).toHaveBeenCalledTimes(1);
  const form = upload.mock.calls[0]?.[0] as FormData;
  expect(JSON.parse(String(form.get('metadata')))).toMatchObject({ capturedEditId: 'edit-1', rect: { x: 1, y: 2, width: 40, height: 30 } });
  dispose();
});
