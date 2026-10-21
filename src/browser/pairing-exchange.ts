import { readBoundedJSON } from "./bounded-response.ts";
import { jsonCopy } from "../json.ts";
import type {
  CredentialedConnection,
  PairingExchangeOptions,
} from "./pairing-contracts.ts";
const text = (value: unknown, max = 2048) => {
  if (typeof value !== "string" || !value || value.length > max)
    throw Error("Invalid connection response");
  return value;
};
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(Error("Connection cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** One cancellable credential exchange, used only in trusted service-frame/shell entries. */
export async function pairingExchange(
  options: PairingExchangeOptions,
): Promise<CredentialedConnection> {
  const binding = jsonCopy(options.binding),
    origin = new URL(options.origin).origin,
    signal = options.signal;
  const fetcher = options.fetch ?? fetch,
    now = options.now ?? Date.now,
    wait = options.sleep ?? sleep;
  const active = () => {
    if (signal.aborted) throw Error("Connection cancelled");
  };
  async function call(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    active();
    const response = await fetcher(origin + path, {
      method: "POST",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    active();
    const value = await readBoundedJSON(response, 8 * 1024 * 1024);
    active();
    if (!response.ok && response.status !== 202)
      throw Error(
        typeof value.error === "string" ? value.error : "Connection failed",
      );
    return { response, value };
  }
  const publishing = !binding.fileId;
  const purpose = options.purpose ?? "document";
  const { value: pair } = await call(
    publishing ? "/api/pair/publish" : "/api/pair",
    publishing
      ? {
          purpose,
          source: binding.source,
          requestId: binding.requestId,
          sources: binding.sources ?? {},
        }
      : { fileId: binding.fileId, purpose },
    publishing ? {} : { Authorization: "Bearer " + (binding.share ?? "") },
  );
  const code = text(pair.code, 256),
    deviceCode = text(pair.deviceCode);
  active();
  options.approve(origin + "/connect?code=" + encodeURIComponent(code));
  const deadline = now() + 300000;
  while (now() < deadline) {
    await wait(1500, signal);
    active();
    if (now() >= deadline) break;
    const { response, value } = await call("/api/pair/poll", { deviceCode });
    active();
    if (response.status === 202) continue;
    if (purpose === "document" && value.purpose !== "document")
      throw Error(
        "Server did not grant the requested document capability purpose",
      );
    const result: CredentialedConnection = {
      token: text(value.token),
      username: text(value.username, 256),
    };
    if (publishing) {
      if (!value.publication) throw Error("Missing publication");
      result.publication = {
        fileId: text(value.publication.fileId, 256),
        share: text(value.publication.share),
        sourceRevision: text(value.publication.sourceRevision, 256),
      };
    }
    active();
    return result;
  }
  throw Error("Connection expired. Try Connect again.");
}
