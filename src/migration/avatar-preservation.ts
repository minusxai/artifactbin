import { createHash } from "node:crypto";
import { emailAddress } from "../email.ts";
import { profileInput } from "../chrome-model.ts";
import { canonicalMigrationValue as canonical } from "./verification-values.ts";
import type { AvatarPreservationBaseProof, AvatarPreservationCandidate, AvatarPreservationInput, AvatarPreservationPlan, AvatarPreservationSource } from "./avatar-preservation-contracts.ts";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const SHA = /^[a-f0-9]{64}$/;
function requireAvatar(ok: unknown): asserts ok { if (!ok) throw Error("Invalid avatar preservation evidence"); }
/** Pure seal of already verified supplemental objects. Never exposes source identities in errors. */
export function planAvatarPreservation(base: AvatarPreservationBaseProof, source: AvatarPreservationSource, inputs: readonly AvatarPreservationInput[]): AvatarPreservationPlan {
  requireAvatar(base.kind === "verified-base-and-addons" && typeof base.sourceNamespace === "string" && base.sourceNamespace.length > 0 && base.sourceNamespace.length <= 16384);
  for (const digest of [base.archiveManifestSha256, base.baseReportSha256, base.datasetReportSha256, base.visualizationReportSha256]) requireAvatar(typeof digest === "string" && SHA.test(digest));
  requireAvatar(source.archiveManifestSha256 === base.archiveManifestSha256 && source.manifest.sourceNamespace === base.sourceNamespace);
  const users = source.manifest.tables.users ?? [];
  const originals = users.filter(user => user.image_key != null && user.image_key !== "");
  requireAvatar(inputs.length > 0 && inputs.length <= 1000 && inputs.length === originals.length);
  const seen = new Set<string>(), actors = new Set<string>();
  const candidates: AvatarPreservationCandidate[] = inputs.map(input => {
    requireAvatar(typeof input.legacyUserId === "string" && input.legacyUserId.length > 0 && !seen.has(input.legacyUserId)); seen.add(input.legacyUserId);
    const matches = users.filter(user => user.id === input.legacyUserId); requireAvatar(matches.length === 1);
    const user = matches[0]!; requireAvatar(user.kind === "account" && !user.merged_into_user_id);
    let actor: string;
    try { actor = emailAddress(user.email); } catch { throw Error("Invalid avatar preservation identity"); }
    requireAvatar(Object.hasOwn(source.maps.users, input.legacyUserId) && source.maps.users[input.legacyUserId] === actor && !actors.has(actor));
    requireAvatar(users.filter(other => typeof other.email === "string" && other.email.trim().toLowerCase() === actor).length === 1); actors.add(actor);
    requireAvatar(input.bytes instanceof Uint8Array && input.bytes.byteLength > 0 && input.bytes.byteLength <= 112500);
    const object = input.object, bytes = Buffer.from(input.bytes);
    requireAvatar(object.kind === "avatar" && object.contentType === "image/webp" && SHA.test(object.sha256) && object.storageKey === object.sha256 && object.byteLength === bytes.length && bytes.length > 0 && bytes.length <= 112500);
    requireAvatar(object.objectKey === user.image_key && object.objectKey === `avatar/${input.legacyUserId}/${object.sha256.slice(0, 32)}` && sha(bytes) === object.sha256);
    requireAvatar(Number.isSafeInteger(object.width) && object.width > 0 && Number.isSafeInteger(object.height) && object.height > 0);
    requireAvatar(bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length);
    const image = "data:image/webp;base64," + bytes.toString("base64");
    requireAvatar(profileInput({ name: "", image }).image === image);
    return Object.freeze({ legacyUserId: input.legacyUserId, actor, sourceUserSha256: sha(canonical(user)), object: Object.freeze({ objectKey: object.objectKey, kind: "avatar" as const, sha256: object.sha256, byteLength: object.byteLength, width: object.width, height: object.height, contentType: "image/webp" as const, storageKey: object.storageKey }), image, expectedImage: null });
  }).sort((a, b) => a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
  requireAvatar(originals.every(user => typeof user.id === "string" && seen.has(user.id)));
  const sealed = { schemaVersion: 1 as const, base: Object.freeze({ kind: base.kind, sourceNamespace: base.sourceNamespace, archiveManifestSha256: base.archiveManifestSha256, baseReportSha256: base.baseReportSha256, datasetReportSha256: base.datasetReportSha256, visualizationReportSha256: base.visualizationReportSha256 }), candidates: Object.freeze(candidates) };
  return Object.freeze({ ...sealed, sha256: sha(canonical(sealed)) });
}
export function recheckAvatarPreservationPlan(plan: AvatarPreservationPlan, source: AvatarPreservationSource): void {
  requireAvatar(plan.schemaVersion === 1 && SHA.test(plan.sha256));
  const inputs = plan.candidates.map(row => {
    requireAvatar(row.expectedImage === null && typeof row.image === "string" && row.image.startsWith("data:image/webp;base64,"));
    return { legacyUserId: row.legacyUserId, object: row.object, bytes: Buffer.from(row.image.slice(23), "base64") };
  });
  requireAvatar(canonical(planAvatarPreservation(plan.base, source, inputs)) === canonical(plan));
}
