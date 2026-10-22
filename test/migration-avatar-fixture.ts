import { createHash } from "node:crypto";
import type { AvatarPreservationBaseProof, AvatarPreservationInput, AvatarPreservationSource } from "../src/migration/avatar-preservation-contracts.ts";
export function avatarFixture() {
  const bytes = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const users = ["one", "two"].map(id => ({ id, email: id + "@example.test", kind: "account", merged_into_user_id: null, image_key: `avatar/${id}/${sha256.slice(0, 32)}` }));
  const base: AvatarPreservationBaseProof = { kind: "verified-base-and-addons", sourceNamespace: "fixture", archiveManifestSha256: "a".repeat(64), baseReportSha256: "b".repeat(64), datasetReportSha256: "c".repeat(64), visualizationReportSha256: "d".repeat(64) };
  const source: AvatarPreservationSource = { archiveManifestSha256: base.archiveManifestSha256, manifest: { schemaVersion: 1, sourceNamespace: "fixture", exportedAt: "2026-01-01", tables: { users }, artifacts: [], tokenOwners: [] }, maps: { users: Object.fromEntries(users.map(user => [user.id, user.email])) } };
  const inputs: AvatarPreservationInput[] = users.map(user => ({ legacyUserId: user.id, bytes, object: { objectKey: user.image_key, kind: "avatar", sha256, byteLength: bytes.length, width: 1, height: 1, contentType: "image/webp", storageKey: sha256 } }));
  return { base, source, inputs };
}
