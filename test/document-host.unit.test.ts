import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentHost } from "../src/browser/document-host.ts";
import { publicationGate } from "../src/browser/lifecycle.ts";
import type { DocumentState, Viewer } from "../src/contracts.ts";
function setup() {
  let state = {
    fileId: null,
    sourceRevision: "r1",
    sources: {},
    remote: null,
  } as unknown as DocumentState;
  const gate = publicationGate();
  let fail = false;
  const host = createDocumentHost({
    readState: () => state,
    updateState: (reducer) => {
      if (fail) throw Error("write failed");
      state = reducer(state);
    },
    gate,
    source: "source",
    sessionId: "session",
    local: true,
    hosted: false,
    origin: "file://",
    documentPath: "/file.html",
  });
  return {
    host,
    gate,
    state: () => state,
    fail: () => {
      fail = true;
    },
  };
}
const identity = {
  session: true as const,
  username: "actor",
  origin: "https://example.test",
  publication: { fileId: "id", share: "share", sourceRevision: "r1" },
};
test("publication installs binding before authority; failed persistence and suspension preserve authority", () => {
  const x = setup();
  x.fail();
  assert.throws(() => x.host.applyConnection(identity), /write failed/);
  assert.equal(x.host.read().session, null);
  const y = setup();
  y.gate.suspend();
  assert.throws(() => y.host.applyConnection(identity), /suspended/);
  assert.equal(y.state().fileId, null);
});
test("broker identity never becomes a credential; disconnect retains anonymous link binding", () => {
  const { host, state } = setup();
  assert.equal(host.applyConnection(identity).publicationChanged, true);
  assert.equal(state().fileId, "id");
  assert.equal(host.transportConnection().token, "share");
  assert.equal(
    host.applyConnection({
      ...identity,
      publication: undefined,
      session: "actor-token",
    }).publicationChanged,
    false,
  );
  assert.equal(host.transportConnection().token, "actor-token");
  host.disconnectIdentity();
  assert.equal(host.read().username, null);
  assert.equal(host.transportConnection().token, "share");
});
test("roster projection ignores cursor movement and owns its returned data", () => {
  const { host } = setup();
  const viewers: Viewer[] = [
    {
      actor: "actor",
      sessionId: "s",
      sourceRevision: "r1",
      cursor: null,
      shareView: true,
    },
  ];
  const status = {
    mode: "active" as const,
    sync: "synced" as const,
    permissions: null,
    viewers,
    message: "",
  };
  assert.equal(host.observeCollaboration(status).rosterChanged, true);
  viewers[0]!.actor = "changed";
  assert.equal(host.read().viewers[0]!.actor, "actor");
  const snapshot = host.read();
  assert.throws(() => {
    snapshot.viewers.length = 0;
  }, TypeError);
  assert.equal(host.read().viewers.length, 1);
  assert.equal(
    host.observeCollaboration({
      ...status,
      viewers: [
        {
          ...viewers[0]!,
          actor: "actor",
          cursor: { x: 1, y: 2, nodeId: "node" },
        },
      ],
    }).rosterChanged,
    false,
  );
  host.disconnectIdentity();
  assert.deepEqual(host.read().viewers, []);
});
test("all binding adapters read current persisted revision and own source caches", () => {
  let state = {
    fileId: "id",
    sourceRevision: "r1",
    sources: { r1: "source" },
    remote: { origin: "https://example.test", share: "share", head: "r1" },
  } as unknown as DocumentState;
  const host = createDocumentHost({
    readState: () => state,
    updateState: (reducer) => {
      state = reducer(state);
    },
    gate: { active: true },
    source: "source",
    sessionId: "s",
    local: false,
    hosted: true,
    origin: "https://example.test",
    documentPath: "/d/id",
  });
  const binding = host.connectionBinding();
  assert.throws(() => {
    binding.sources!.r1 = "changed";
  }, TypeError);
  state = { ...state, sourceRevision: "r2" };
  assert.equal(host.connectionBinding().sourceRevision, "r2");
  assert.equal(host.transportConnection().sourceRevision, "r2");
});
test("publication persistence observes old identity; identity-only reconnect leaves binding untouched", () => {
  let state = {
    fileId: null,
    sourceRevision: "r1",
    sources: {},
    remote: null,
  } as unknown as DocumentState;
  let writes = 0;
  const host = createDocumentHost({
    readState: () => state,
    updateState: (reducer) => {
      assert.equal(host.read().username, null);
      writes++;
      state = reducer(state);
    },
    gate: { active: true },
    source: "source",
    sessionId: "s",
    local: true,
    hosted: false,
    origin: "file://",
    documentPath: "/file.html",
  });
  host.applyConnection(identity);
  host.applyConnection({
    session: true,
    username: "replacement",
    origin: identity.origin,
  });
  assert.equal(writes, 1);
  assert.equal(host.read().username, "replacement");
});
test("hosted permission projection and suspension govern comment authority; preview enables shared mode", () => {
  const gate = publicationGate();
  const state = {
    fileId: null,
    sourceRevision: "r1",
    sources: {},
    remote: null,
  } as unknown as DocumentState;
  const options = {
    readState: () => state,
    updateState: () => {},
    gate,
    source: "source",
    sessionId: "s",
    local: false,
    hosted: true,
    origin: "https://example.test",
    documentPath: "/d/id",
    initial: { session: "token", username: "actor" },
  };
  const host = createDocumentHost(options);
  assert.deepEqual(host.commentAccess(), {
    active: true,
    placement: "hosted",
    authenticated: true,
    permission: null,
  });
  const permissions = {
    role: "owner" as const,
    read: true,
    comment: true,
    edit: true,
    manage: true,
  };
  const status = {
    mode: "active" as const,
    sync: "synced" as const,
    permissions,
    viewers: [],
    message: "",
  };
  assert.equal(host.observeCollaboration(status).permissionsChanged, true);
  assert.equal(
    host.observeCollaboration({ ...status, permissions: { ...permissions } })
      .permissionsChanged,
    false,
  );
  gate.suspend();
  assert.equal(host.commentAccess().active, false);
  host.disconnectIdentity();
  assert.equal(host.commentAccess().authenticated, false);
  assert.equal(host.commentAccess().permission, null);
});

test("switching identity clears the previous caller permission marker before reauthorization", () => {
  const { host } = setup();
  host.applyConnection(identity);
  host.observeCollaboration({
    mode: "active",
    sync: "synced",
    viewers: [],
    message: "",
    permissions: {
      role: "owner",
      read: true,
      comment: true,
      edit: true,
      manage: true,
      authorizationContext: "previous-caller",
    },
  });
  host.applyConnection({
    ...identity,
    username: "other",
    publication: undefined,
  });
  assert.equal(host.read().permissions, null);
  assert.equal(host.read().sync, "disconnected");
});
