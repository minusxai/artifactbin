import type { PlatformClient, PlatformBinding } from "./platform-contracts.ts";
import type {
  ConnectionCoordinator,
  ConnectionCoordinatorOptions,
  ConnectionPopup,
} from "./connection-coordinator-contracts.ts";
/** Owns connection authority, broker lifetime and stale pairing suppression; UI only renders callbacks. */
export function createConnectionCoordinator(
  options: ConnectionCoordinatorOptions,
): ConnectionCoordinator {
  let client: PlatformClient | null = null,
    clientOrigin: string | undefined,
    ready = false,
    disposed = false,
    connecting = false,
    popup: ConnectionPopup | null = null;
  let generation = 0,
    clientGeneration = 0,
    pairEpoch = -1;
  function normalized(value: string | undefined) {
    if (!value) throw Error("Choose a platform server");
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw Error("Use HTTPS for a remote server, or HTTP on localhost.");
    return url.origin;
  }
  function requestBinding(binding: PlatformBinding): PlatformBinding {
    const value: PlatformBinding = {
      sourceRevision: binding.sourceRevision,
      sessionId: binding.sessionId,
    };
    if (binding.fileId) {
      value.fileId = binding.fileId;
      if (binding.share !== undefined) value.share = binding.share;
      if (binding.version !== undefined) value.version = binding.version;
    } else {
      if (binding.source !== undefined) value.source = binding.source;
      if (binding.requestId !== undefined) value.requestId = binding.requestId;
      if (binding.sources !== undefined) value.sources = binding.sources;
    }
    return value;
  }
  function clearClient() {
    clientGeneration++;
    client?.dispose();
    client = null;
    clientOrigin = undefined;
    ready = false;
  }
  function broker(origin = options.binding().origin) {
    if (disposed) throw Error("Connection coordinator disposed");
    const target = normalized(origin);
    if (!client || clientOrigin !== target) {
      clearClient();
      const token = clientGeneration;
      clientOrigin = target;
      client = options.createClient({
        ...requestBinding(options.binding()),
        origin: target,
        onEvent(event) {
          if (disposed || token !== clientGeneration) return;
          if (event.type === "pairing") {
            if (!connecting || !options.gate.accepts(pairEpoch)) return;
            if (popup) popup.navigate(event.url);
            else options.approveLink(event.url);
            return;
          }
          options.onEvent(event);
        },
      });
      const created = client;
      void created.ready.then(
        () => {
          if (client === created) ready = true;
        },
        () => {
          if (client === created) clearClient();
        },
      );
    }
    return client;
  }
  function cancel() {
    generation++;
    options.trusted?.cancel();
    popup?.close();
    popup = null;
    if (connecting) {
      connecting = false;
      if (options.local) clearClient();
    }
  }
  return {
    broker,
    existingBroker: () => client,
    async connect(origin) {
      if (disposed) throw Error("Connection coordinator disposed");
      if (connecting) throw Error("Connection already in progress");
      const binding = options.binding(),
        target = normalized(binding.origin || origin);
      const epoch = options.gate.epoch;
      options.gate.assert(epoch);
      const operation = ++generation;
      connecting = true;
      pairEpoch = epoch;
      const current = () =>
        !disposed && generation === operation && options.gate.accepts(epoch);
      try {
        // Open synchronously while the initiating user gesture is still available.
        if (options.local || !binding.origin) popup = options.openPopup();
        if (!current()) return;
        let result;
        let session: string | true = true;
        if (options.local) {
          if (client && !ready) clearClient();
          result = await broker(target).pair();
        } else {
          if (!options.trusted)
            throw Error("Trusted connection service unavailable");
          const credentialed = await options.trusted.connect(
            target,
            requestBinding(binding),
            (url) => {
              if (current()) options.approveLink(url);
            },
          );
          result = credentialed;
          session = credentialed.token;
        }
        if (!current()) return;
        options.apply({
          username: result.username,
          ...(result.publication ? { publication: result.publication } : {}),
          origin: target,
          session,
        });
        await options.connected();
      } catch (error) {
        if (current()) throw error;
      } finally {
        if (generation === operation) {
          connecting = false;
          popup?.close();
          popup = null;
        }
      }
    },
    cancel,
    async disconnect() {
      cancel();
      if (options.local) await client?.disconnect();
    },
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      clearClient();
    },
  };
}
