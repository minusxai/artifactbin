import { isDeepStrictEqual } from "node:util";
import type { SqlClient, SqlDatabase } from "../persistence/sql.ts";
import { destinationSchemas } from "./destination-schema.ts";
import { groupHandleReceipt, planGroupHandles } from "./group-handles.ts";
import type {
  GroupHandlePlan,
  GroupHandlePreservation,
} from "./group-handles-contracts.ts";

/** Explicit offline amendment only. Run after unchanged base and additive verifiers.
 * This module never grants memberships, enables groups or supplies login credentials. */
export function createGroupHandlePreservation(
  database: SqlDatabase,
  schema: string,
): GroupHandlePreservation {
  const { runtime, archive } = destinationSchemas(schema);
  const receipts = `${archive}.group_handle_receipts`;

  function canonical(plan: GroupHandlePlan): GroupHandlePlan {
    const expected = planGroupHandles(plan.base, plan.candidates);
    if (!isDeepStrictEqual(expected, plan))
      throw Error("Invalid group handle plan");
    return expected;
  }
  async function source(client: SqlClient, plan: GroupHandlePlan) {
    const row = (
      await client.query(
        `SELECT digest,manifest,maps FROM ${archive}.archives WHERE namespace=$1 FOR SHARE`,
        [plan.base.sourceNamespace],
      )
    ).rows[0];
    if (!row || row.digest !== plan.base.archiveManifestSha256)
      throw Error("Group handle source archive changed");
    const manifest = row.manifest as {
      tables?: { groups?: Record<string, unknown>[] };
    };
    const maps = row.maps as { groups?: Record<string, unknown> };
    if (!Array.isArray(manifest?.tables?.groups) || !maps?.groups)
      throw Error("Group handle source evidence missing");
    for (const candidate of plan.candidates) {
      const groups = manifest.tables.groups.filter(
        (group) => group.id === candidate.legacyGroupId,
      );
      if (
        groups.length !== 1 ||
        groups[0]!.handle !== candidate.sourceHandle ||
        !!groups[0]!.deleted_at !== candidate.sourceDeleted ||
        !Object.hasOwn(maps.groups, candidate.legacyGroupId) ||
        maps.groups[candidate.legacyGroupId] !== candidate.actor
      )
        throw Error("Group handle source or mapping changed");
    }
  }
  async function principals(
    client: SqlClient,
    plan: GroupHandlePlan,
    applied: boolean,
  ) {
    const actors = plan.candidates.map((row) => row.actor);
    const rows = (
      await client.query(
        `SELECT a.actor,a.principal_kind,a.salt,a.password,a.handle,g.active FROM ${runtime}.accounts a JOIN ${runtime}.groups g ON g.owner=a.actor WHERE a.actor=ANY($1::text[]) ORDER BY a.actor FOR SHARE OF a,g`,
        [actors],
      )
    ).rows;
    for (const candidate of plan.candidates) {
      const row = rows.find((row) => row.actor === candidate.actor);
      if (
        !row ||
        row.principal_kind !== "group" ||
        row.salt !== null ||
        row.password !== null ||
        row.active !== !candidate.sourceDeleted
      )
        throw Error("Group handle principal or active state changed");
      if (row.handle !== (applied ? candidate.sourceHandle : null))
        throw Error(
          applied
            ? "Preserved group handle changed"
            : "Group handle expected NULL",
        );
    }
    if (
      (
        await client.query(
          `SELECT 1 FROM ${runtime}.sessions WHERE actor=ANY($1::text[]) LIMIT 1`,
          [actors],
        )
      ).rows.length
    )
      throw Error("Group principals must remain nonlogin");
  }
  async function audit(client: SqlClient, plan: GroupHandlePlan) {
    await source(client, plan);
    const receipt = groupHandleReceipt(plan);
    const row = (
      await client.query(
        `SELECT plan_sha256,receipt FROM ${receipts} WHERE namespace=$1 FOR SHARE`,
        [plan.base.sourceNamespace],
      )
    ).rows[0];
    if (
      !row ||
      row.plan_sha256 !== plan.sha256 ||
      !isDeepStrictEqual(row.receipt, receipt)
    )
      throw Error("Group handle preservation receipt missing or changed");
    await principals(client, plan, true);
    return receipt;
  }
  return {
    apply: (input) => {
      const plan = canonical(input);
      return database.transaction(async (client) => {
        // Serializes account/group handle claims, including concurrent account inserts.
        // The unique accounts.handle constraint remains a second independent check.
        await client.query(
          `LOCK TABLE ${runtime}.accounts IN SHARE ROW EXCLUSIVE MODE`,
        );
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${receipts}(namespace text PRIMARY KEY,plan_sha256 text NOT NULL,receipt jsonb NOT NULL)`,
        );
        const old = (
          await client.query(
            `SELECT plan_sha256 FROM ${receipts} WHERE namespace=$1 FOR UPDATE`,
            [plan.base.sourceNamespace],
          )
        ).rows[0];
        if (old)
          return {
            status: "already-applied" as const,
            receipt: await audit(client, plan),
          };
        await source(client, plan);
        await principals(client, plan, false);
        const collision = (
          await client.query(
            `SELECT actor FROM ${runtime}.accounts WHERE handle=ANY($1::text[]) LIMIT 1`,
            [plan.candidates.map((row) => row.sourceHandle)],
          )
        ).rows.length;
        if (collision)
          throw Error(
            "Group handle collision in shared account/group namespace",
          );
        for (const row of plan.candidates) {
          const changed = (
            await client.query(
              `UPDATE ${runtime}.accounts SET handle=$2 WHERE actor=$1 AND handle IS NULL RETURNING actor`,
              [row.actor, row.sourceHandle],
            )
          ).rows;
          if (changed.length !== 1) throw Error("Group handle expected NULL");
        }
        const receipt = groupHandleReceipt(plan);
        await client.query(`INSERT INTO ${receipts} VALUES($1,$2,$3::jsonb)`, [
          plan.base.sourceNamespace,
          plan.sha256,
          JSON.stringify(receipt),
        ]);
        return { status: "applied" as const, receipt };
      });
    },
    verify: (input) => {
      const plan = canonical(input);
      return database.transaction((client) => audit(client, plan));
    },
  };
}
