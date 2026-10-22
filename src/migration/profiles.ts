import type { LegacyRow } from "./contracts.ts";
import type { MigrationProfileProjection } from "./profile-contracts.ts";
/** Original public labels only. Login accounts, emails and object storage keys never enter this catalog. */
export function projectMigrationProfiles(
  users: readonly LegacyRow[],
  assets: readonly import("./assets/projection-contracts.ts").MigrationProfileAsset[] = [],
): MigrationProfileProjection {
  const profiles: MigrationProfileProjection["profiles"][number][] = [];
  const seen = new Set<string>();
  let unavailableAvatarImages = 0;
  for (const row of users) {
    if (typeof row.id !== "string" || !row.id || seen.has(row.id))
      throw Error("Ambiguous legacy profile identity");
    seen.add(row.id);
    for (const key of ["name", "username"])
      if (row[key] != null && typeof row[key] !== "string")
        throw Error("Invalid legacy public profile");
    const name =
      typeof row.name === "string" && row.name
        ? row.name
        : typeof row.username === "string" && row.username
          ? row.username
          : row.id;
    const handle =
      typeof row.username === "string" && row.username ? row.username : null;
    const asset = assets.find(
      (asset) =>
        asset.legacyUserId === row.id && asset.objectKey === row.image_key,
    );
    if (typeof row.image_key === "string" && row.image_key && !asset)
      unavailableAvatarImages++;
    profiles.push({
      legacyUserId: row.id,
      name,
      handle,
      image: asset?.assetId ?? null,
    });
  }
  return { profiles, unavailableAvatarImages };
}
