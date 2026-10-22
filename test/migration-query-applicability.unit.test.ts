import test from "node:test";
import assert from "node:assert/strict";
import { prepareMigrationPageQueries } from "../src/migration/job-queries.ts";
import type { PlannedPage } from "../src/migration/contracts.ts";
function page(source: string): PlannedPage {
  return {
    pageId: "abc123",
    legacyId: "abc123",
    disposition: "ready",
    issues: [],
    owner: { kind: "user", id: "owner@example.test" },
    original: {
      id: "abc123",
      version: 1,
      format: "markup",
      source,
      document: null,
      user_id: "owner",
      group_id: null,
      token_id: null,
      visibility: "private",
      link_role: "viewer",
    },
    access: { visibility: "private", linkRole: "viewer", shares: [] },
    comments: [],
    identities: [],
    revisions: [],
  };
}
test("inactive query registration never invokes compiler or changes readiness for ordinary local/member queries or browser author scripts", async () => {
  const pages = [
    page(
      '<Helmet><Query name="members">{`select * from _members`}</Query></Helmet><p>Kept</p>',
    ),
    page(
      '<Helmet><Import name="sales" src="ref:data01"/><Query name="rows">{`select * from sales.rows`}</Query></Helmet>',
    ),
    page(
      '<Helmet><script type="module">{`export default()=>null`}</script></Helmet>',
    ),
    page('<p>script type="server" is prose</p>'),
  ];
  let calls = 0;
  await prepareMigrationPageQueries(pages, undefined, {
    compilerIdentity: "a".repeat(64),
    compiler: async () => {
      calls++;
      throw Error("not reached");
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(
    pages.map((p) => [p.disposition, p.issues, p.serverQueries]),
    pages.map(() => ["ready", [], undefined]),
  );
});
test("actual server-module page without an exact existing backend/snapshot remains explicitly unavailable", async () => {
  const candidate = page(
    '<Helmet><script type="server">{`export default()=>1`}</script></Helmet>',
  );
  let calls = 0;
  await prepareMigrationPageQueries([candidate], undefined, {
    compilerIdentity: "a".repeat(64),
    compiler: async () => {
      calls++;
      return null;
    },
  });
  assert.equal(calls, 0);
  assert.equal(candidate.disposition, "blocked");
  assert.deepEqual(candidate.issues, ["query_registration_unavailable"]);
});
