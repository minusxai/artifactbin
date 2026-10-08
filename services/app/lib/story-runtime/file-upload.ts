/** Authenticated dataset attachment transport shared by page scripts and controls. */
import type { DatasetUploadResult } from '@artifactbin/contracts';
import type { ImageUploadContext } from './store';
import { runtimeId } from './runtime-id';

const keys = new WeakMap<ImageUploadContext, WeakMap<File, Map<string, string>>>();

export async function uploadDatasetFile(context: ImageUploadContext | undefined, datasetId: string, editId: string, file: File): Promise<DatasetUploadResult> {
  if (!context) throw new Error('page.upload requires a signed-in reader');
  if (!editId) throw new Error('This document is not ready for uploads. Reload and retry.');
  let files = keys.get(context);
  if (!files) keys.set(context, files = new WeakMap());
  let scoped = files.get(file);
  if (!scoped) files.set(file, scoped = new Map());
  const scope = `${datasetId}:${editId}`;
  const key = scoped.get(scope) ?? runtimeId();
  scoped.set(scope, key);
  const url = context[0].replace('/query', `/datasets/${encodeURIComponent(datasetId)}/files`);
  const response = await context[1](url, {
    method: 'POST', credentials: context[2],
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), 'X-Edit-Id': editId, 'Idempotency-Key': key }, body: file,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = body as { detail?: unknown; error?: unknown } | null;
    throw new Error(typeof failure?.detail === 'string' ? failure.detail : typeof failure?.error === 'string' ? failure.error : `Upload failed (${response.status}). Retry the same file.`);
  }
  const result = body as DatasetUploadResult | null;
  if (!result || !/^dfile:[a-z0-9]+$/.test(result.ref) || typeof result.url !== 'string' || !result.url || typeof result.name !== 'string' || !result.name || typeof result.contentType !== 'string' || !result.contentType || !Number.isSafeInteger(result.size) || result.size < 0) {
    throw new Error('The upload response was incomplete. Retry the same file to recover its reference.');
  }
  return result;
}
