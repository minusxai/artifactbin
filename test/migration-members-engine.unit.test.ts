import test from "node:test";
import assert from "node:assert/strict";
import { forwardArchivedMembersContext } from "../src/migration/conversion/compiled/members-engine.ts";
test("audited member context forwarding fails closed on a changed or ambiguous archived port", () => {
  const marker =
    "...(ctx.localTables ? { localTables: ctx.localTables } : {}),";
  const source = "evaluateDataflow({run},flow,imports,{" + marker + "});";
  assert.match(
    forwardArchivedMembersContext(source),
    /\.\.\.\(ctx\.members \? \{ members: ctx\.members \} : \{\}\)/,
  );
  for (const text of [
    "",
    source.replace(marker, ""),
    source + marker,
    source.replace("evaluateDataflow", "other"),
  ])
    assert.throws(() => forwardArchivedMembersContext(text));
});
