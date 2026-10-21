import type {
  ConnectorCaller,
  HttpBinding,
  HttpOperation,
  Json,
} from "./contracts.ts";
import { ConnectorError, snapshot } from "./json.ts";
export function destination(
  binding: HttpBinding,
  op: HttpOperation,
  loopback: boolean,
): URL {
  const origin = new URL(binding.origin),
    url = new URL(op.path, origin);
  if (
    url.origin !== origin.origin ||
    origin.username ||
    origin.password ||
    url.username ||
    url.password ||
    origin.search ||
    origin.hash ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        loopback &&
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      ))
  )
    throw new ConnectorError("INVALID");
  if (op.method !== "POST") throw new ConnectorError("INVALID");
  return url;
}
export async function invokeHttp(
  binding: HttpBinding,
  op: HttpOperation,
  caller: ConnectorCaller,
  input: Json,
  signal: AbortSignal,
  maxBytes: number,
  loopback: boolean,
  dispatch: () => void,
): Promise<Json> {
  const url = destination(binding, op, loopback);
  const body = JSON.stringify({
    caller: { tenant: caller.tenant, subject: caller.subject },
    input,
  });
  if (Buffer.byteLength(body) > maxBytes) throw new ConnectorError("INVALID");
  signal.throwIfAborted();
  dispatch();
  const response = await fetch(url, {
    method: op.method,
    redirect: "error",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${binding.token}`,
    },
    body,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ConnectorError("UNAVAILABLE", "unknown");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectorError("INVALID", "unknown");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new ConnectorError("INVALID", "unknown");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return snapshot(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      maxBytes,
    );
  } catch {
    throw new ConnectorError("INVALID", "unknown");
  }
}
