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
  assert.deepEqual(
    libraryListing({ folder: "/", files, folders, query: "research" }),
    {
      state: "rows",
      visible: ["/notes.html"],
    },
  );
  assert.deepEqual(
    libraryListing({ folder: "/", files, folders, query: "nothing" }),
    {
      state: "no-results",
      visible: [],
    },
  );
});
test("an empty library or folder is empty; a folder that does not exist is missing", () => {
  assert.equal(
    libraryListing({ folder: "/", files: [], folders: [], query: "" }).state,
    "empty",
  );
  assert.equal(
    libraryListing({ folder: "/work/2026", files, folders, query: "" }).state,
    "empty",
  );
  assert.deepEqual(
    libraryListing({ folder: "/Nope", files, folders, query: "" }),
    {
      state: "missing",
      visible: [],
    },
  );
});

test("one library search matches owned and shared artifact titles or paths without changing their order", async () => {
  const { filterLibraryEntries } = await import(
    "../src/library-client/listing.ts"
  );
  const shared = [
    {
      path: "/shared/research.html",
      title: "Research & development",
      fileId: "First1",
    },
    { path: "/shared/plan.html", title: "Quarterly plan", fileId: "Second" },
  ];
  assert.deepEqual(filterLibraryEntries(shared, "RESEARCH"), [shared[0]]);
  assert.deepEqual(filterLibraryEntries(shared, "/shared/plan"), [shared[1]]);
  assert.deepEqual(filterLibraryEntries(shared, "missing"), []);
  assert.deepEqual(filterLibraryEntries(shared, ""), shared);
});

test("shared-only libraries retain search and suppress first-artifact onboarding", async () => {
  const { librarySurface } = await import("../src/library-client/listing.ts");
  assert.deepEqual(librarySurface("empty", 2, 2), {
    onboarding: false,
    toolbar: true,
    noResults: false,
  });
  assert.deepEqual(librarySurface("empty", 2, 0), {
    onboarding: false,
    toolbar: true,
    noResults: true,
  });
  assert.deepEqual(librarySurface("empty", 0, 0), {
    onboarding: true,
    toolbar: false,
    noResults: false,
  });
  assert.deepEqual(librarySurface("no-results", 2, 1), {
    onboarding: false,
    toolbar: true,
    noResults: false,
  });
  assert.deepEqual(librarySurface("no-results", 0, 0), {
    onboarding: false,
    toolbar: true,
    noResults: true,
  });
});
