/** Platform side of backend calls: validates a page's request and calls the server with the viewer's session. */
import type { AfJsonObject } from "../af-contracts.ts";
import type { RemoteBridgeResponse, RemoteHost, RemoteHostOptions } from "./remote-bridge-contracts.ts";

const MAX_QUERY = 100_000;
const MAX_VARIABLES = 1_000_000;

function plainObject(value: unknown): value is AfJsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createRemoteHost(options: RemoteHostOptions): RemoteHost {
  const inFlight = new Set<string>();
  const refuse = (id: string, message: string) => options.reply({ id, error: { message, sent: false } });
  return {
    handle(message) {
      const value = message as { kind?: unknown; id?: unknown; request?: unknown };
      if (value?.kind !== "remote-request") return false;
      const id = value.id;
      if (typeof id !== "string" || !id || id.length > 200 || inFlight.has(id)) return true;
      const request = value.request as { query?: unknown; variables?: unknown; operation?: unknown };
      if (
        !plainObject(request) ||
        typeof request.query !== "string" ||
        request.query.length > MAX_QUERY ||
        !plainObject(request.variables) ||
        JSON.stringify(request.variables).length > MAX_VARIABLES ||
        (request.operation !== "query" && request.operation !== "mutation")
      ) {
        refuse(id, "Invalid backend request");
        return true;
      }
      const endpoint = options.endpoint();
      if (!options.active()) return refuse(id, "Backends are unavailable in a saved view"), true;
      if (!endpoint) return refuse(id, "Publish this page to call its backends"), true;
      if (!options.online()) return refuse(id, "offline"), true;
      if (inFlight.size >= 16) return refuse(id, "Too many backend calls at once"), true;
      inFlight.add(id);
      const reply = (response: RemoteBridgeResponse) => {
        inFlight.delete(id);
        options.reply(response);
      };
      options
        .post(endpoint, { query: request.query, variables: request.variables })
        .then(({ status, body }) => {
          const error = plainObject(body) && typeof body.error === "string" ? body.error : `Backend call failed (${status})`;
          if (status >= 200 && status < 300 && plainObject(body))
            reply({ id, response: body as unknown as NonNullable<RemoteBridgeResponse["response"]> });
          // The server refused the request before running anything.
          else if (status >= 400 && status < 500 && status !== 408 && status !== 429)
            reply({ id, response: { data: null, errors: [{ message: error }] } });
          else reply({ id, error: { message: error, sent: true } });
        })
        .catch((error: unknown) =>
          reply({ id, error: { message: error instanceof Error ? error.message : String(error), sent: true } }),
        );
      return true;
    },
  };
}
