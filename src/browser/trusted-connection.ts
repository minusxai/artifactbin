import { pairingExchange } from "./pairing-exchange.ts";
import type { TrustedConnection } from "./pairing-contracts.ts";
declare global {
  interface Window {
    __pagegiTrustedConnection?: TrustedConnection;
  }
}
/** Trusted shell entry owns approval window, cancellation and credential exchange. */
export function createTrustedConnection(): TrustedConnection {
  let controller: AbortController | undefined;
  let popup: Window | null = null;
  function cancel() {
    controller?.abort();
    controller = undefined;
    popup?.close();
    popup = null;
  }
  const port: TrustedConnection = {
    async connect(origin, binding, approve) {
      cancel();
      const operation = new AbortController();
      controller = operation;
      const approval = window.open(
        "about:blank",
        "pagegi-connect",
        "width=480,height=620",
      );
      popup = approval;
      try {
        return await pairingExchange({
          origin,
          binding,
          approve(url) {
            operation.signal.throwIfAborted();
            if (approval) approval.location.href = url;
            else approve(url);
          },
          signal: operation.signal,
        });
      } finally {
        approval?.close();
        if (controller === operation) {
          controller = undefined;
          popup = null;
        }
      }
    },
    cancel,
  };
  return Object.freeze(port);
}
if (typeof window !== "undefined")
  window.__pagegiTrustedConnection = createTrustedConnection();
