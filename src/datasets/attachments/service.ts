import {
  DATASET_ATTACHMENT_LIMITS,
  DatasetAttachmentError,
} from "./contracts.ts";
import type {
  DatasetAttachmentService,
  DatasetAttachmentRepository,
  DatasetAttachmentStorage,
  DatasetAttachmentUpload,
  DatasetAttachmentStaged,
} from "./contracts.ts";
import { datasetAttachmentAllowed } from "./policy.ts";
const id = /^[a-f0-9]{32}$/;
const segment = /^[A-Za-z0-9_-]{1,128}$/;
function validUpload(u: DatasetAttachmentUpload): boolean {
  return (
    !!u &&
    /^[A-Za-z0-9_.-]{8,120}$/.test(u.requestId) &&
    typeof u.filename === "string" &&
    u.filename.length > 0 &&
    u.filename.length <= 255 &&
    !/[\uD800-\uDFFF]/u.test(u.filename) &&
    !/[\x00-\x1f\x7f/\\]/.test(u.filename) &&
    ["image/png", "image/jpeg", "image/webp"].includes(u.contentType) &&
    !!u.body?.[Symbol.asyncIterator]
  );
}
/** Coordinates authority and object I/O; only the repository may make the final atomic commit decision. */
export function createDatasetAttachmentService({
  repository,
  storage,
}: {
  repository: DatasetAttachmentRepository;
  storage: DatasetAttachmentStorage;
}): DatasetAttachmentService {
  let active = 0;
  let healthy = true;
  return {
    async availability(context, signal) {
      signal?.throwIfAborted();
      const a = await repository.authority(context, signal);
      signal?.throwIfAborted();
      return {
        canAttempt:
          healthy && !!a && datasetAttachmentAllowed(context, a, "insert"),
      };
    },
    async upload(context, upload, callerSignal) {
      if (
        !validUpload(upload) ||
        !segment.test(context.pageId) ||
        !segment.test(context.backendNamespace) ||
        !segment.test(context.bindingName)
      )
        throw new DatasetAttachmentError("invalid_request");
      if (!healthy) throw new DatasetAttachmentError("unavailable");
      if (active >= DATASET_ATTACHMENT_LIMITS.maxConcurrent)
        throw new DatasetAttachmentError("busy");
      active++;
      const signal = callerSignal
        ? AbortSignal.any([
            callerSignal,
            AbortSignal.timeout(DATASET_ATTACHMENT_LIMITS.timeoutMs),
          ])
        : AbortSignal.timeout(DATASET_ATTACHMENT_LIMITS.timeoutMs);
      let staged: DatasetAttachmentStaged | undefined;
      try {
        signal.throwIfAborted();
        const initial = await repository.authority(context, signal);
        signal.throwIfAborted();
        if (
          !initial ||
          !datasetAttachmentAllowed(context, initial, "insert") ||
          !initial.registration.acceptedTypes.includes(upload.contentType)
        )
          throw new DatasetAttachmentError("denied");
        staged = await storage.stage(upload, signal);
        signal.throwIfAborted();
        const { body: _body, ...request } = upload;
        const { record, replayed } = await repository.commit(
          { context, request, initial, staged },
          signal,
        );
        // A commit can succeed just before cancellation. Never invent an absent receipt or resend with a new key.
        signal.throwIfAborted();
        if (!id.test(record.id))
          throw new DatasetAttachmentError("unavailable");
        return {
          ref: `dfile:${record.id}`,
          url: `/api/files/${context.pageId}/dataset-attachments/${context.backendNamespace}/${context.bindingName}/${record.id}`,
          name: record.object.filename,
          contentType: record.object.contentType,
          size: record.object.byteLength,
          ...(replayed ? { replayed: true } : {}),
        };
      } finally {
        try {
          await staged?.discard();
        } catch (error) {
          healthy = false;
          throw error;
        } finally {
          active--;
        }
      }
    },
    async read(context, fileId, signal) {
      if (!id.test(fileId)) return null;
      signal?.throwIfAborted();
      const first = await repository.read(context, fileId, signal);
      if (!first) return null;
      const opened = await storage.open(first.record.object, signal);
      try {
        signal?.throwIfAborted();
        const fresh = await repository.read(context, fileId, signal);
        signal?.throwIfAborted();
        if (
          !fresh ||
          fresh.generation !== first.generation ||
          JSON.stringify(fresh.record) !== JSON.stringify(first.record)
        ) {
          await opened.close();
          return null;
        }
        return { record: fresh.record, ...opened };
      } catch (error) {
        await opened.close();
        throw error;
      }
    },
  };
}
