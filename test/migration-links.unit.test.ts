import test from "node:test";
import assert from "node:assert/strict";
import { rewriteMigrationLinks } from "../src/migration/links.ts";
test("links map known legacy addresses and explicit origins while preserving unrelated text and external URLs", () => {
  const html =
    '<a href="https://legacy.example.test/a/oldIdentifier?q=1#x">oldIdentifier</a><a href="/@some-handle/oldIdentifier">Profile</a><a href="https://other.example.test/a/oldIdentifier">External</a><p>/a/oldIdentifier</p>';
  const result = rewriteMigrationLinks(
    html,
    { pages: { oldIdentifier: "abc123" }, users: {}, groups: {}, tokens: {} },
    {
      legacyOrigins: ["https://legacy.example.test"],
      targetOrigin: "https://new.example.test",
    },
  );
  assert.ok(result.includes('href="https://new.example.test/a/abc123?q=1#x"'));
  assert.ok(result.includes('href="/a/abc123"'));
  assert.ok(result.includes("https://other.example.test/a/oldIdentifier"));
  assert.ok(result.includes("<p>/a/oldIdentifier</p>"));
});

test("slug links canonicalize only exact known paths and admitted targets", () => {
  const maps = {
    pages: { ABC123: "def456", BLOCK1: "xyz789" },
    users: {},
    groups: {},
    tokens: {},
  };
  const diagnostics: unknown[] = [];
  const result = rewriteMigrationLinks(
    '<a href="/@user/ABC123-title-slug?q=1#part">A</a><a href="/a/BLOCK1-title?x=1#y">B</a><a href="https://foreign.test/@user/ABC123-title">C</a><a href="/@user/ABC123-title/extra">D</a>',
    maps,
    {
      legacyOrigins: ["https://legacy.test"],
      targetOrigin: "https://new.test",
      readyPages: new Set(["def456"]),
      onDiagnostic: (d) => diagnostics.push(d),
    },
  );
  assert.ok(result.includes('href="/a/def456?q=1#part"'));
  assert.ok(result.includes('href="https://legacy.test/a/BLOCK1-title?x=1#y"'));
  assert.ok(result.includes("https://foreign.test/@user/ABC123-title"));
  assert.ok(result.includes("/@user/ABC123-title/extra"));
  assert.deepEqual(diagnostics, [
    {
      legacyId: "BLOCK1",
      pageId: "xyz789",
      disposition: "legacy-target-blocked",
    },
  ]);
});

test("blocked references without a configured origin remain visible and report configuration", () => {
  const diagnostics: unknown[] = [];
  const html = '<a href="/@owner/ABC123-title#quote">Saved link</a>';
  assert.equal(
    rewriteMigrationLinks(
      html,
      { pages: { ABC123: "def456" }, users: {}, tokens: {}, groups: {} },
      {
        legacyOrigins: [],
        targetOrigin: "https://new.test",
        readyPages: new Set(),
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      },
    ),
    html,
  );
  assert.deepEqual(diagnostics, [
    {
      legacyId: "ABC123",
      pageId: "def456",
      disposition: "legacy-origin-required",
    },
  ]);
});
