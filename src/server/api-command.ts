import { parseFileRoute } from "./request.ts";
import type { ApiCommand, ApiCommandRequest } from "./request-contracts.ts";
/** Decode endpoint grammar only. Authorization and body validation belong to the selected service. */
export function parseApiCommand({
  method,
  url,
  body,
  headers,
}: ApiCommandRequest): ApiCommand | null {
  const route = parseFileRoute(url.pathname);
  if (!route) return null;
  const { fileId, parts } = route,
    endpoint = parts[3];
  const ifMatch =
    typeof headers.ifMatch === "string"
      ? headers.ifMatch
      : headers.ifMatch?.[0];
  if (endpoint === "backends" || endpoint === "graphql")
    return { kind: "backend", fileId, endpoint, method, body };
  if (endpoint === "source") {
    if (method === "GET") return { kind: "source.read", fileId };
    if (method === "PUT")
      return {
        kind: "source.save",
        fileId,
        body,
        ifMatch,
        key: headers.idempotencyKey,
      };
  }
  if (endpoint === "comments") {
    if (parts.length === 4 && method === "GET")
      return {
        kind: "comments.list",
        fileId,
        since: url.searchParams.get("since"),
      };
    if (parts.length === 4 && method === "POST")
      return {
        kind: "comments.add",
        fileId,
        body,
        key: headers.idempotencyKey,
      };
    if (parts.length === 5 && method === "PUT")
      return {
        kind: "comments.edit",
        fileId,
        commentId: parts[4]!,
        ifMatch,
        body,
      };
  }
  if (endpoint === "capture" && method === "POST")
    return { kind: "comments.capture", fileId, sessionId: body.sessionId };
  if (endpoint === "context" && method === "GET")
    return { kind: "comments.context", fileId, commentId: parts[4]! };
  if (
    method === "GET" &&
    (endpoint === "permissions" ||
      endpoint === "sharing" ||
      endpoint === "profiles" ||
      endpoint === "presence")
  )
    return { kind: "collaboration", fileId, command: { kind: endpoint } };
  if (endpoint === "sharing" && method === "PUT")
    return {
      kind: "collaboration",
      fileId,
      command: {
        kind: "change-sharing",
        policy: body,
        expectedVersion: Number(
          String(headers.ifMatch ?? "").replace(/^"|"$/g, ""),
        ),
      },
    };
  if (endpoint === "presence" && method === "PUT")
    return {
      kind: "collaboration",
      fileId,
      command: { kind: "update-presence", input: body },
    };
  if (endpoint === "revoke" && method === "POST")
    return { kind: "collaboration", fileId, command: { kind: "revoke" } };
  return null;
}
