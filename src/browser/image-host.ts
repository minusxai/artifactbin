import type { ImageBridgeHostOptions } from "./image-bridge-contracts.ts";
import { parseSupplementalAddress } from "../media/supplemental-address.ts";
export function createImageHost(options: ImageBridgeHostOptions) {
  const pending = new Map<string, AbortController>();
  return {
    handle(message: unknown): boolean {
      if (
        !message ||
        typeof message !== "object" ||
        !("kind" in message) ||
        !["image-request", "image-cancel"].includes(String(message.kind))
      )
        return false;
      const value = message as {
        kind: string;
        id?: unknown;
        url?: unknown;
        authorizationContext?: unknown;
      };
      if (typeof value.id !== "string" || !value.id || value.id.length > 200)
        return true;
      const id = value.id;
      if (value.kind === "image-cancel") {
        pending.get(id)?.abort();
        pending.delete(id);
        return true;
      }
      const address =
          typeof value.url === "string"
            ? parseSupplementalAddress(value.url)
            : null,
        context = options.authority();
      if (
        !address ||
        address.kind !== "person" ||
        address.pageId !== options.pageId() ||
        !context ||
        context !== value.authorizationContext ||
        pending.has(id) ||
        pending.size >= 16
      ) {
        options.reply({ id, error: "Image unavailable" });
        return true;
      }
      const controller = new AbortController();
      pending.set(id, controller);
      void options
        .load(address, context, controller.signal)
        .then((image) => {
          if (controller.signal.aborted) return;
          if (
            options.authority() !== context ||
            options.pageId() !== address.pageId
          ) {
            options.reply({ id, error: "Image caller changed" });
            return;
          }
          options.reply({ id, image });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            options.reply({ id, error: "Image unavailable" });
        })
        .finally(() => {
          if (pending.get(id) === controller) pending.delete(id);
        });
      return true;
    },
    invalidate() {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    },
  };
}
