import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, SESSION_PATH } from "../../../src/af-script/transport.ts";
import { MemoryFs } from "../support/lifecycle-fakes.ts";

const ORIGIN = "http://server.test";
const env = { AF_SERVER: ORIGIN, AF_TOKEN: "tok" };

/** Ports whose fetch answers from `answers` by "METHOD path"; the session probe answers `session`. */
function ports(answers: Record<string, number>, session: number | "error") {
  const calls: string[] = [];
  const fs = new MemoryFs();
  return {
    calls,
    ports: {
      fs,
      now: () => 0,
      random: () => "k",
      sleep: async () => {},
      fetch: async (url: string, init?: { method?: string }) => {
        const path = url.slice(ORIGIN.length);
        const key = `${init?.method ?? "GET"} ${path}`;
        calls.push(key);
        if (path === SESSION_PATH) {
          if (session === "error") throw new Error("offline");
          return new Response("{}", { status: session });
        }
        const status = answers[key] ?? 404;
        return new Response(JSON.stringify({ error: status === 403 ? "Access expired or revoked. Ask the owner for access." : "x" }), { status });
      },
    },
  };
}

test("a 403 from a page route becomes 401 when the session probe says the token is dead", async () => {
  const { ports: p, calls } = ports({ "PUT /api/files/Pg4mQ2/source": 403 }, 401);
  const server = await connect(env, p as never, "save");
  const sent = await server.send({ method: "PUT", path: "/api/files/Pg4mQ2/source", body: { source: "" } });
  assert.equal(sent.kind, "response");
  assert.equal((sent as { status: number }).status, 401);
  assert.deepEqual(calls, ["PUT /api/files/Pg4mQ2/source", `GET ${SESSION_PATH}`], "one probe, no retry of the write");
});

test("a 403 stays a 403 when the token is alive or the probe gets no answer", async () => {
  for (const session of [200, "error"] as const) {
    const { ports: p } = ports({ "PUT /api/files/Pg4mQ2/source": 403 }, session);
    const server = await connect(env, p as never, "save");
    const sent = await server.send({ method: "PUT", path: "/api/files/Pg4mQ2/source", body: { source: "" } });
    assert.equal((sent as { status: number }).status, 403, `probe answered ${session}`);
  }
});

test("other statuses never trigger the probe", async () => {
  const { ports: p, calls } = ports({ "PUT /api/files/Pg4mQ2/source": 409 }, 401);
  const server = await connect(env, p as never, "save");
  const sent = await server.send({ method: "PUT", path: "/api/files/Pg4mQ2/source", body: { source: "" } });
  assert.equal((sent as { status: number }).status, 409);
  assert.deepEqual(calls, ["PUT /api/files/Pg4mQ2/source"]);
});
