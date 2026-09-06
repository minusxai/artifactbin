import { requestOrSessionActor } from "../viewer";
import { refusesCrossSite } from "../auth";
import { remoteSessions, RemoteError } from "./registry";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function remoteRoute(
  request: Request,
  id?: string,
  exchange = false,
): Promise<Response> {
  try {
    const actor = await requestOrSessionActor(request);
    if (
      actor.credential === "none" ||
      (request.headers.has("authorization") && actor.credential !== "bearer")
    )
      return json({ error: "Authentication required. Run afbin auth." }, 401);
    if (!actor.viewer?.userId)
      return json(
        { error: "Use a token claimed by your artifactbin account." },
        403,
      );
    if (refusesCrossSite(request, actor))
      return json({ error: "Forbidden" }, 403);
    const owner = actor.viewer.userId;
    if (request.method === "GET") {
      if (!id) return json({ sessions: remoteSessions.list(owner) });
      const since = Number(
        new URL(request.url).searchParams.get("since") ?? -1,
      );
      if (!Number.isSafeInteger(since)) throw new RemoteError("Invalid cursor");
      return json(await remoteSessions.view(owner, id, since));
    }
    if (request.method === "DELETE" && id) {
      remoteSessions.remove(owner, id);
      return json({ ok: true });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    // Bound the body while streaming, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    let raw = "";
    const decoder = new TextDecoder();
    let bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 512000) {
            await reader.cancel();
            throw new RemoteError("Request too large", 413);
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new RemoteError("Invalid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new RemoteError("Invalid body");
    if (!id) return json(remoteSessions.create(owner, body), 201);
    if (exchange) return json(await remoteSessions.exchange(owner, id, body));
    if (body.type === "input") remoteSessions.input(owner, id, body.data);
    else if (body.type === "control")
      remoteSessions.control(owner, id, body.controller, body.cols, body.rows);
    else throw new RemoteError("Invalid operation");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof RemoteError)
      return json({ error: error.message }, error.status);
    console.error(
      "Remote relay error",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ error: "Remote relay unavailable" }, 500);
  }
}
