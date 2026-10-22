import type {
  CompiledPayloadLoader,
  CompiledPayloadLoaderPorts,
} from "./javascript-payload-contracts.ts";
/** Own one document's pending decode and module URL. BFCache freezes this same boot. */
export function startCompiledPayload(
  ports: CompiledPayloadLoaderPorts,
): CompiledPayloadLoader {
  const controller = new AbortController();
  let retired = false,
    url: string | null = null;
  const release = () => {
    if (url !== null) {
      const owned = url;
      url = null;
      ports.revokeURL(owned);
    }
  };
  const settled = (async () => {
    try {
      const source = await ports.decode(controller.signal);
      if (retired) return;
      url = ports.createURL(source);
      if (retired) return;
      await ports.importModule(url);
    } catch {
      if (!retired) ports.error();
    } finally {
      release();
    }
  })();
  return {
    settled,
    pagehide(persisted) {
      if (persisted || retired) return;
      retired = true;
      controller.abort();
      release();
    },
  };
}
