import test from "node:test";
import assert from "node:assert/strict";
import { planAvatarPreservation, recheckAvatarPreservationPlan } from "../src/migration/avatar-preservation.ts";
import { avatarFixture } from "./migration-avatar-fixture.ts";
test("avatar plan preserves exact public bytes, source mappings and immutable post-addon provenance", () => {
  const f = avatarFixture(); const plan = planAvatarPreservation(f.base, f.source, f.inputs);
  assert.equal(plan.candidates.length, 2); assert.equal(plan.candidates[0]!.image, "data:image/webp;base64," + Buffer.from(f.inputs[0]!.bytes).toString("base64"));
  recheckAvatarPreservationPlan(plan, f.source);
  assert.throws(() => (plan.candidates as unknown[]).pop());
  assert.throws(() => Object.assign(plan.base, { datasetReportSha256: "0".repeat(64) }));
  assert.throws(() => recheckAvatarPreservationPlan({ ...plan, sha256: "0".repeat(64) }, f.source));
  assert.throws(() => planAvatarPreservation({ ...f.base, visualizationReportSha256: "" }, f.source, f.inputs));
});
test("avatar plan refuses mismapped actors, ambiguous source rows and changed source or object bytes", () => {
  const f = avatarFixture(); const plan = planAvatarPreservation(f.base, f.source, f.inputs);
  assert.throws(() => planAvatarPreservation(f.base, { ...f.source, maps: { users: { one: "other@example.test", two: "two@example.test" } } }, f.inputs));
  const changed = structuredClone(f.source); changed.manifest.tables.users![0]!.name = "changed";
  assert.throws(() => recheckAvatarPreservationPlan(plan, changed));
  assert.throws(() => planAvatarPreservation(f.base, { ...f.source, manifest: { ...f.source.manifest, tables: { users: [...f.source.manifest.tables.users!, f.source.manifest.tables.users![0]!] } } }, f.inputs));
  assert.throws(() => planAvatarPreservation(f.base, f.source, [f.inputs[0]!, f.inputs[0]!]));
  assert.throws(() => planAvatarPreservation(f.base, f.source, [{ ...f.inputs[0]!, bytes: Buffer.from("bad") }]));
});
test("avatar plan refuses alternate MIME, source keys, oversized data URLs and incomplete avatar coverage", () => {
  const f = avatarFixture(); const first = f.inputs[0]!;
  assert.throws(() => planAvatarPreservation(f.base, f.source, [{ ...first, object: { ...first.object, contentType: "image/png" as "image/webp" } }, f.inputs[1]!]));
  assert.throws(() => planAvatarPreservation(f.base, f.source, [{ ...first, object: { ...first.object, objectKey: "avatar/other/" + first.object.sha256.slice(0, 32) } }, f.inputs[1]!]));
  assert.throws(() => planAvatarPreservation(f.base, f.source, [first]));
  assert.throws(() => planAvatarPreservation(f.base, f.source, [{ ...first, bytes: Buffer.alloc(150000) }, f.inputs[1]!]));
});
