import { describe, expect, it, afterEach } from "vitest";
import { useAppHarness, request, agentCookie } from "./harness";
import { mintToken } from "@/lib/tokens";
import { createUser, claimToken } from "@/lib/users";
import { remoteRoute } from "@/lib/remote/route";
import { RemoteRegistry, remoteSessions } from "@/lib/remote/registry";
useAppHarness();
afterEach(() => remoteSessions.clear());
const registration = {
  name: "Dashboard",
  harness: "claude",
  cwd: "/project",
  machine: "laptop",
  cols: 80,
  rows: 24,
};
const body = (runnerKey: string, outputSeq = 1, output = "hello") => ({
  runnerKey,
  outputSeq,
  output,
  ack: 0,
  cols: 80,
  rows: 24,
});
describe("remote session relay", () => {
  it("requires an account-owned credential and keeps sessions private across accounts", async () => {
    const a = await mintToken("a");
    expect(
      (
        await remoteRoute(
          request("/api/remote/sessions", {
            method: "POST",
            token: a.token,
            json: registration,
          }),
        )
      ).status,
    ).toBe(403);
    const user = await createUser({ email: "mxmx_test_remote@example.com" });
    await claimToken(user.id, a.token);
    const res = await remoteRoute(
      request("/api/remote/sessions", {
        method: "POST",
        token: a.token,
        json: registration,
      }),
    );
    expect(res.status).toBe(201);
    const made = await res.json();
    const cookie = await agentCookie([a.id]);
    const list = await remoteRoute(request("/api/remote/sessions", { cookie }));
    expect(await list.json()).toMatchObject({ sessions: [{ id: made.id }] });
    expect(
      JSON.stringify(
        await (
          await remoteRoute(request("/api/remote/sessions", { token: a.token }))
        ).json(),
      ),
    ).not.toContain(made.runnerKey);
    const b = await mintToken("b");
    const other = await createUser({ email: "mxmx_test_other@example.com" });
    await claimToken(other.id, b.token);
    expect(
      (
        await remoteRoute(
          request(`/api/remote/sessions/${made.id}`, { token: b.token }),
          made.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await remoteRoute(
          request(`/api/remote/sessions/${made.id}`, {
            method: "POST",
            cookie,
            origin: "https://evil.example",
            json: { type: "input", data: "rm -rf" },
          }),
          made.id,
        )
      ).status,
    ).toBe(403);
  });
  it("replays output, deduplicates exchanged batches and comment input, and enforces controller and runner key", async () => {
    const r = new RemoteRegistry();
    const s = r.create("a", registration);
    await expect(r.exchange("a", s.id, body("wrong"))).rejects.toThrow();
    await r.exchange("a", s.id, body(s.runnerKey));
    await r.exchange("a", s.id, body(s.runnerKey));
    expect((await r.view("a", s.id, 0)).frames).toHaveLength(1);
    expect((await r.view("a", s.id, -1)).snapshot).toContain("hello");
    expect(() => r.input("a", s.id, "keyboard")).toThrow();
    r.input("a", s.id, "comment\r", "comment", "comment-1");
    r.input("a", s.id, "comment\r", "comment", "comment-1");
    const x = await r.exchange("a", s.id, body(s.runnerKey));
    expect(x.inputs).toHaveLength(1);
    expect(
      (
        await r.exchange("a", s.id, {
          ...body(s.runnerKey),
          ack: x.inputs[0].id,
        })
      ).inputs,
    ).toHaveLength(0);
    r.control("a", s.id, "web", 40, 15);
    r.input("a", s.id, "keyboard");
    expect(
      (await r.exchange("a", s.id, body(s.runnerKey))).inputs.some(
        (i) => i.data === "keyboard",
      ),
    ).toBe(true);
    expect(() => r.input("b", s.id, "bad")).toThrow();
    r.clear();
  });
  it("marks missed heartbeats offline and rejects input to exited or stale sessions", async () => {
    let now = 0;
    const r = new RemoteRegistry(() => now);
    const s = r.create("a", registration);
    now = 31000;
    expect(r.list("a")[0].online).toBe(false);
    expect(() => r.input("a", s.id, "x", "comment")).toThrow();
    await r.exchange("a", s.id, { ...body(s.runnerKey), exitCode: 0 });
    expect(r.list("a")[0].exitCode).toBe(0);
    expect(() => r.input("a", s.id, "x", "comment")).toThrow();
    r.clear();
  });
});

import { notifyRemoteComment } from "@/lib/remote/mentions";
it("delivers explicit human session mentions only to the commenting account, without control characters or repeated delivery", async () => {
  const r = new RemoteRegistry();
  const own = r.create("a", registration),
    other = r.create("b", registration);
  const comment = {
    id: "c1",
    body: `[@Dashboard](/chat?session=${own.id}) fix this\n\x03 [@Other](/chat?session=${other.id})`,
    author: {
      kind: "human" as const,
      label: "owner",
      transport: "browser" as const,
    },
    created_at: new Date().toISOString(),
  };
  notifyRemoteComment("a", "artifact", "annotation", comment, r);
  notifyRemoteComment("a", "artifact", "annotation", comment, r);
  const x = await r.exchange("a", own.id, body(own.runnerKey));
  expect(x.inputs).toHaveLength(1);
  expect(x.inputs[0].data).toContain("artifact");
  expect(x.inputs[0].data).not.toContain("\x03");
  expect(x.inputs[0].data!.endsWith("\r")).toBe(true);
  expect(
    (await r.exchange("b", other.id, body(other.runnerKey))).inputs,
  ).toHaveLength(0);
  notifyRemoteComment(
    "a",
    "artifact",
    "annotation",
    { ...comment, id: "c2", author: { ...comment.author, kind: "agent" } },
    r,
  );
  expect(
    (await r.exchange("a", own.id, body(own.runnerKey))).inputs,
  ).toHaveLength(1);
  r.clear();
});

import { POST as createArtifact } from "@/app/api/artifacts/route";
import { POST as createComment } from "@/app/api/my/artifacts/[id]/annotations/route";
import { POST as replyComment } from "@/app/api/my/artifacts/[id]/annotations/[annId]/route";
it("the real comment and reply routes notify the selected session after saving", async () => {
  const t = await mintToken("remote");
  const user = await createUser({
    email: "mxmx_test_comment_remote@example.com",
  });
  await claimToken(user.id, t.token);
  const cookie = await agentCookie([t.id]);
  const session = remoteSessions.create(user.id, registration);
  const created = await createArtifact(
    request("/api/artifacts", {
      method: "POST",
      token: t.token,
      json: { markup: "<p>Review this paragraph.</p>" },
    }),
  );
  expect(created.status).toBe(201);
  const doc = await created.json();
  const mention = `[@Dashboard](/chat?session=${session.id})`;
  const res = await createComment(
    request(`/api/my/artifacts/${doc.id}/annotations`, {
      method: "POST",
      cookie,
      json: { path: "0", edit_id: doc.edit_id, body: `${mention} review this` },
    }),
    { params: Promise.resolve({ id: doc.id }) },
  );
  expect(res.status).toBe(201);
  const ann = await res.json();
  let exchange = await remoteSessions.exchange(
    user.id,
    session.id,
    body(session.runnerKey),
  );
  expect(exchange.inputs).toHaveLength(1);
  expect(JSON.parse(exchange.inputs[0].data!)).toMatchObject({
    artifact_id: doc.id,
    annotation_id: ann.id,
    comment_id: ann.thread[0].id,
  });
  const reply = await replyComment(
    request(`/api/my/artifacts/${doc.id}/annotations/${ann.id}`, {
      method: "POST",
      cookie,
      json: { reply: `${mention} one more thing` },
    }),
    { params: Promise.resolve({ id: doc.id, annId: ann.id }) },
  );
  expect(reply.status).toBe(200);
  exchange = await remoteSessions.exchange(
    user.id,
    session.id,
    body(session.runnerKey),
  );
  expect(exchange.inputs).toHaveLength(2);
});
