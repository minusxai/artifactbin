import { destinationSchemas } from "./destination-schema.ts";
import { planMigrationGroups } from "./groups.ts";
import { isPreservedNonloginActor } from "./identities.ts";
import { requireMigrationEquality as equal } from "./verification-values.ts";
import type {
  SqlReader,
  MigrationManifest,
  MigrationMaps,
} from "./contracts.ts";
export async function verifyMigrationAuthority(
  db: SqlReader,
  schema: string,
  manifest: MigrationManifest,
  maps: MigrationMaps,
): Promise<number> {
  const { runtime } = destinationSchemas(schema);
  const actors = [
    ...new Set([
      ...Object.values(maps.users),
      ...Object.values(maps.tokens),
      ...Object.values(maps.orphans ?? {}),
    ]),
  ];
  for (let i = 0; i < actors.length; i += 100) {
    const chunk = actors.slice(i, i + 100);
    const rows = (
      await db.query(
        `SELECT actor,salt,password,handle FROM ${runtime}.accounts WHERE actor=ANY($1::text[]) ORDER BY actor`,
        [chunk],
      )
    ).rows;
    equal(
      rows.map((r) => r.actor),
      chunk.sort(),
      "preserved account identities",
    );
    for (const row of rows)
      if (isPreservedNonloginActor(String(row.actor)))
        equal(
          { salt: row.salt, password: row.password, handle: row.handle },
          { salt: null, password: null, handle: null },
          "nonlogin account credentials",
        );
  }
  for (const group of planMigrationGroups(manifest, maps.users).groups) {
    equal(
      (
        await db.query(
          `SELECT principal_kind,salt,password,handle FROM ${runtime}.accounts WHERE actor=$1`,
          [group.actor],
        )
      ).rows,
      [{ principal_kind: "group", salt: null, password: null, handle: null }],
      "group principal credentials",
    );
    equal(
      (
        await db.query(`SELECT active FROM ${runtime}.groups WHERE owner=$1`, [
          group.actor,
        ])
      ).rows,
      [{ active: group.active }],
      "group active authority",
    );
    equal(
      (
        await db.query(
          `SELECT actor,role FROM ${runtime}.group_memberships WHERE owner=$1 ORDER BY actor`,
          [group.actor],
        )
      ).rows,
      group.members
        .map((m) => ({ actor: m.actor, role: m.role }))
        .sort((a, b) => a.actor.localeCompare(b.actor)),
      "exact group memberships",
    );
  }
  const reserved = [
    ...actors.filter(isPreservedNonloginActor),
    ...Object.values(maps.groups),
  ];
  if (reserved.length) {
    const sessions = (
      await db.query(
        `SELECT 1 FROM ${runtime}.sessions WHERE actor=ANY($1::text[]) LIMIT 1`,
        [reserved],
      )
    ).rows;
    equal(sessions, [], "nonlogin session exclusion");
  }
  return actors.length;
}
