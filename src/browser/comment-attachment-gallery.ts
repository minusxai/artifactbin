import type {
  CommentAttachmentLease,
  CommentAttachmentGallery,
  CommentAttachmentGalleryOptions,
} from "./comment-attachments-contracts.ts";
/** Read-only trusted chrome. Image sources are exclusively leased Blob URLs. */
export function createCommentAttachmentGallery(
  options: CommentAttachmentGalleryOptions,
): CommentAttachmentGallery {
  const { parent, resources, commentId } = options,
    document = parent.ownerDocument;
  const container = document.createElement("div");
  container.className = "pg-comment-attachments";
  container.setAttribute("aria-label", "Comment attachments");
  const controllers = new Set<AbortController>(),
    leases = new Set<CommentAttachmentLease>();
  let disposed = false,
    modalLease: CommentAttachmentLease | null = null,
    modalRead: AbortController | null = null,
    opener: HTMLButtonElement | null = null;
  const dialog = document.createElement("dialog");
  dialog.className = "pg-attachment-dialog";
  dialog.setAttribute("aria-label", "Comment image");
  const close = document.createElement("button");
  close.textContent = "Close image";
  const full = document.createElement("img");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  dialog.append(close, status, full);
  function closeImage() {
    modalRead?.abort();
    modalRead = null;
    modalLease?.release();
    modalLease = null;
    full.removeAttribute("src");
    if (dialog.open) dialog.close();
    if (opener?.isConnected) opener.focus();
  }
  close.onclick = closeImage;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImage();
  });
  dialog.addEventListener("close", () => {
    // Native close events are queued: a previous close must not cancel a reopened view.
    if (dialog.open) return;
    modalRead?.abort();
    modalRead = null;
    modalLease?.release();
    modalLease = null;
    full.removeAttribute("src");
  });
  for (const attachment of options.attachments) {
    const thumbnail =
      attachment.variants.find((v) => v.variant === "thumbnail") ??
      attachment.variants.find((v) => v.variant === "preview") ??
      attachment.variants.find((v) => v.variant === "original");
    const large =
      attachment.variants.find((v) => v.variant === "original") ??
      attachment.variants.find((v) => v.variant === "preview") ??
      thumbnail;
    if (!thumbnail || !large) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pg-attachment-thumbnail";
    button.setAttribute("aria-label", "View attachment: " + attachment.name);
    const image = document.createElement("img");
    image.alt = "";
    image.width = thumbnail.width;
    image.height = thumbnail.height;
    const label = document.createElement("span");
    label.textContent = attachment.name;
    button.append(image, label);
    container.append(button);
    const controller = new AbortController();
    controllers.add(controller);
    void resources
      .acquire(commentId, attachment, thumbnail, controller.signal)
      .then((lease) => {
        if (disposed || controller.signal.aborted) {
          lease.release();
          return;
        }
        leases.add(lease);
        image.src = lease.url;
      })
      .catch(() => {
        if (!disposed && !controller.signal.aborted)
          label.textContent = attachment.name + " (image unavailable)";
      })
      .finally(() => controllers.delete(controller));
    button.onclick = () => {
      closeImage();
      opener = button;
      status.textContent = "Loading image…";
      full.alt = attachment.name;
      dialog.showModal();
      close.focus();
      const read = new AbortController();
      modalRead = read;
      void resources
        .acquire(commentId, attachment, large, read.signal)
        .then((lease) => {
          if (disposed || read.signal.aborted || modalRead !== read) {
            lease.release();
            return;
          }
          modalLease = lease;
          full.src = lease.url;
          status.textContent = "";
        })
        .catch(() => {
          if (!disposed && !read.signal.aborted)
            status.textContent = "Image unavailable";
        });
    };
  }
  container.append(dialog);
  parent.append(container);
  const unsubscribe = resources.subscribeInvalidation(() => {
    closeImage();
    for (const controller of controllers) controller.abort();
    for (const lease of leases) lease.release();
    leases.clear();
    for (const image of container.querySelectorAll("img"))
      image.removeAttribute("src");
    for (const button of container.querySelectorAll("button"))
      button.disabled = true;
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      closeImage();
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const lease of leases) lease.release();
      leases.clear();
      container.remove();
    },
  };
}
