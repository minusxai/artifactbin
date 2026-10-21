import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryActions } from "../src/library-client/actions.ts";
import { MAX_PAGE_SOURCE } from "../src/af-contracts.ts";
const file = (name: string, text: string, size = text.length) => ({
  name,
  size,
  text: async () => text,
});
test("an example in a folder is named by the server, and retries resend the same request", async () => {
  const calls: any[] = [];
  let attempts = 0;
  const a = createLibraryActions({
    folder: "/work",
    id: () => "same-id",
    request: async <T>(_p: string, body: unknown) => {
      calls.push(body);
      if (!attempts++) throw Error("lost");
      return { url: "/ok" } as T;
    },
  });
  await assert.rejects(a.createExample(), /lost/);
  assert.equal(await a.createExample(), "/ok");
  assert.deepEqual(calls, [
    { requestId: "same-id", folder: "/work" },
    { requestId: "same-id", folder: "/work" },
  ]);
});
test("publish refuses, in plain words and before any request, what the server would refuse", async () => {
  let reads = 0,
    calls = 0;
  const a = createLibraryActions({
    folder: "/",
    id: () => "id",
    request: async <T>() => {
      calls++;
      return {} as T;
    },
  });
  const unread = (name: string, size: number) => ({
    name,
    size,
    text: async () => {
      reads++;
      return "";
    },
  });
  await assert.rejects(
    a.publish(unread("huge.html", 3 * MAX_PAGE_SOURCE + 1)),
    /^Error: Choose an HTML file under 4,000,000 characters \(about 4 MB\)\.$/,
  );
  await assert.rejects(a.publish(unread("notes.txt", 10)), /Choose an HTML file \(\.html or \.htm\)\./);
  await assert.rejects(a.publish(unread("empty.html", 0)), /This file is empty\./);
  assert.equal(reads, 0);
  await assert.rejects(a.publish(file("blank.html", "  \n ")), /This file is empty\./);
  await assert.rejects(
    a.publish(file("big.html", "x".repeat(MAX_PAGE_SOURCE + 1), MAX_PAGE_SOURCE + 1)),
    /under 4,000,000 characters/,
  );
  await assert.rejects(
    a.publish(file("Meeting notes — draft #2.html", "<h1>Hi</h1>")),
    /can’t contain “#”/,
  );
  await assert.rejects(a.move(["/a"], "/a/b"));
  assert.equal(calls, 0);
});
test("commands preserve path boundaries, collapse selected descendants, and publish exact size limit", async () => {
  const calls: any[] = [];
  const a = createLibraryActions({
    folder: "/work",
    id: () => "id",
    request: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return { url: "/published" } as T;
    },
  });
  await a.rename("/old/file.html", "new.html");
  await a.createFolder("nested");
  await a.move(["/a", "/a/b"], "/destination");
  await a.removeFolder("/empty");
  const limit = "x".repeat(MAX_PAGE_SOURCE - 11) + "<h1>Hi</h1>";
  assert.equal(await a.publish(file("x.HTM", limit)), "/published");
  assert.deepEqual(
    calls.map((c) => c.body),
    [
      { kind: "move", from: "/old/file.html", path: "/old/new.html" },
      { kind: "folder", path: "/work/nested" },
      { kind: "move-many", paths: ["/a"], destination: "/destination" },
      { kind: "remove-folder", path: "/empty" },
      { html: limit, path: "/work/x.HTM", requestId: "id" },
    ],
  );
  await assert.rejects(a.createFolder("../escape"));
  await assert.rejects(a.rename("/a", "b/c"));
  await assert.rejects(a.createFolder("a?b"), /can’t contain “\?”/);
  assert.equal(calls.length, 5);
});
test("root example leaves naming to server and failed file reads make no publication", async () => {
  const bodies: unknown[] = [];
  const a = createLibraryActions({
    folder: "/",
    id: () => "id",
    request: async <T>(_path: string, body: unknown) => {
      bodies.push(body);
      return { url: "/example" } as T;
    },
  });
  assert.equal(await a.createExample(), "/example");
  assert.deepEqual(bodies, [{ requestId: "id" }]);
  await assert.rejects(
    a.publish({
      name: "a.html",
      size: 1,
      text: async () => {
        throw Error("read failed");
      },
    }),
    /read failed/,
  );
  assert.equal(bodies.length, 1);
});
