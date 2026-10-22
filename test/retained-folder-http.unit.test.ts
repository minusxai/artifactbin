import test from "node:test";
import assert from "node:assert/strict";
import { createRetainedFolderRoute } from "../src/retained-folders/http.ts";

test("folder route only reads canonical artifact locators with one explicit namespace", async () => {
  const calls: unknown[] = [];
  const route = createRetainedFolderRoute({
    read: async (...args) => {
      calls.push(args);
      return null;
    },
  });
  for (const path of [
    "/",
    "/a/not-an-id",
    "/a/ABC123/extra",
    "/a/ABC123?namespace=one&namespace=two",
    "/a/ABC123?owner=claim",
    "/a/ABC123?download=1",
  ])
    assert.equal(
      await route(
        "GET",
        new URL(path, "https://platform.invalid"),
        "credential",
      ),
      null,
    );
  assert.equal(
    await route("POST", new URL("https://platform.invalid/a/ABC123")),
    null,
  );
  assert.deepEqual(calls, []);
  await route(
    "HEAD",
    new URL("https://platform.invalid/a/ABC123-title?namespace=fixture"),
    "credential",
  );
  assert.deepEqual(calls, [["ABC123", "credential", "fixture"]]);
});

test("folder route refuses noncanonical or executable result links", async () => {
  const route = createRetainedFolderRoute({
    read: async () => ({
      id: "ABC123",
      title: "Folder",
      trail: [],
      rows: [
        {
          id: "DEF456",
          title: "Child",
          kind: "page",
          url: "javascript:alert(1)",
        },
      ],
    }),
  });
  await assert.rejects(
    route("GET", new URL("https://platform.invalid/a/ABC123")),
    /Invalid retained folder view/,
  );
});
