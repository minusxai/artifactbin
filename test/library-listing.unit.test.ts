import test from "node:test";
import assert from "node:assert/strict";
import { libraryListing } from "../src/library-client/listing.ts";
const files = [
  { path: "/notes.html", title: "Research notes" },
  { path: "/work/plan.html", title: "Plan" },
];
const folders = ["/work", "/work/2026"];
test("a folder lists its own folders first, then its documents, filtered by name or title", () => {
  assert.deepEqual(libraryListing({ folder: "/", files, folders, query: "" }), {
    state: "rows",
    visible: ["/work", "/notes.html"],
  });
  assert.deepEqual(libraryListing({ folder: "/", files, folders, query: "research" }), {
    state: "rows",
    visible: ["/notes.html"],
  });
  assert.deepEqual(libraryListing({ folder: "/", files, folders, query: "nothing" }), {
    state: "no-results",
    visible: [],
  });
});
test("an empty library or folder is empty; a folder that does not exist is missing", () => {
  assert.equal(libraryListing({ folder: "/", files: [], folders: [], query: "" }).state, "empty");
  assert.equal(libraryListing({ folder: "/work/2026", files, folders, query: "" }).state, "empty");
  assert.deepEqual(libraryListing({ folder: "/Nope", files, folders, query: "" }), {
    state: "missing",
    visible: [],
  });
});
