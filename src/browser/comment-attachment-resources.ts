import type {
  CommentAttachmentResources,
  CommentAttachmentResourcesOptions,
} from "./comment-attachments-contracts.ts";
const imageTypes = new Set([
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
]);
/** Owns one authority epoch and every transient image URL issued under it. */
export function createCommentAttachmentResources(
  options: CommentAttachmentResourcesOptions,
): CommentAttachmentResources {
  let authority: string | null = null,
    epoch = 0,
    disposed = false;
  const pending = new Set<AbortController>(),
    leases = new Set<() => void>(),
    listeners = new Set<() => void>();
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  function retire() {
    epoch++;
    for (const controller of pending) controller.abort();
    pending.clear();
    for (const release of [...leases]) release();
    for (const listener of [...listeners]) listener();
  }
  const api: CommentAttachmentResources = {
    get revision() {
      return epoch;
    },
    setAuthority(context) {
      if (disposed || context === authority) return;
      authority = context;
      retire();
    },
    async acquire(commentId, attachment, variant, signal) {
      if (disposed || !authority) throw Error("Attachment access unavailable");
      if (
        !commentId ||
        !attachment.id ||
        !attachment.variants.includes(variant) ||
        !["thumbnail", "preview", "original"].includes(variant.variant) ||
        !imageTypes.has(variant.mimeType) ||
        !/^[a-f0-9]{64}$/.test(variant.sha256) ||
        ![variant.bytes, variant.width, variant.height].every(
          (n) => Number.isSafeInteger(n) && n > 0,
        ) ||
        variant.bytes > maxBytes
      )
        throw Error("Invalid attachment metadata");
      if (pending.size + leases.size >= 32)
        throw Error("Too many attachment reads");
      const current = epoch,
        controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      pending.add(controller);
      try {
        if (controller.signal.aborted) throw Error("Attachment read cancelled");
        const blob = await options.load(
          commentId,
          attachment.id,
          variant.variant,
          controller.signal,
        );
        if (disposed || current !== epoch || controller.signal.aborted)
          throw Error("Attachment read cancelled");
        if (
          blob.type !== variant.mimeType ||
          blob.size !== variant.bytes ||
          blob.size > maxBytes
        )
          throw Error("Unexpected attachment image");
        const url = options.createURL(blob);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          leases.delete(release);
          options.revokeURL(url);
        };
        leases.add(release);
        return { url, release };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (current === epoch && (status === 401 || status === 403))
          api.setAuthority(null);
        throw error;
      } finally {
        pending.delete(controller);
        signal?.removeEventListener("abort", cancel);
      }
    },
    subscribeInvalidation(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      authority = null;
      retire();
      listeners.clear();
    },
  };
  return api;
}
