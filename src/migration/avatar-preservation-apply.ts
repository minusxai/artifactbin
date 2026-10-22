import { canonicalMigrationValue as canonical } from "./verification-values.ts";
import { recheckAvatarPreservationPlan } from "./avatar-preservation.ts";
import type { AvatarPreservation, AvatarPreservationDatabase, AvatarPreservationOptions, AvatarPreservationPlan, AvatarPreservationReceipt, AvatarPreservationSource } from "./avatar-preservation-contracts.ts";
function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw Error("Invalid avatar preservation schema");
  return '"' + value + '"';
}
function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(node: unknown): void {
    if (node && typeof node === "object") { for (const child of Object.values(node)) freeze(child); Object.freeze(node); }
  }
  freeze(copy); return copy;
}
/** Explicit operator amendment, never wired into the frozen base importer. */
export function createAvatarPreservation(db: AvatarPreservationDatabase, options: AvatarPreservationOptions): AvatarPreservation {
  const runtime = identifier(options.runtimeSchema), archive = identifier(options.archiveSchema);
  if (typeof options.verifyPrerequisites !== "function") throw Error("Avatar prerequisites require verification");
  let active = false;
  const receipt = (plan: AvatarPreservationPlan): AvatarPreservationReceipt => ({ schemaVersion: 1, plan });
  async function source(plan: AvatarPreservationPlan): Promise<void> {
    const rows = (await db.query(`SELECT digest,manifest,maps FROM ${archive}.archives WHERE namespace=$1 FOR SHARE`, [plan.base.sourceNamespace])).rows;
    if (rows.length !== 1 || rows[0]!.digest !== plan.base.archiveManifestSha256) throw Error("Avatar source archive differs");
    recheckAvatarPreservationPlan(plan, { archiveManifestSha256: String(rows[0]!.digest), manifest: rows[0]!.manifest, maps: rows[0]!.maps } as AvatarPreservationSource);
  }
  async function accounts(plan: AvatarPreservationPlan, alreadyApplied: boolean): Promise<void> {
    const rows = (await db.query(`SELECT actor,image,principal_kind FROM ${runtime}.accounts WHERE actor=ANY($1::text[]) ORDER BY actor FOR UPDATE`, [plan.candidates.map(row => row.actor)])).rows;
    if (rows.length !== plan.candidates.length) throw Error("Avatar account is unavailable");
    for (const candidate of plan.candidates) {
      const row = rows.find(row => row.actor === candidate.actor);
      if (!row || row.principal_kind !== "user" || (row.image !== candidate.image && (alreadyApplied || row.image !== null))) throw Error("Avatar account image changed");
    }
  }
  async function transaction<T>(plan: AvatarPreservationPlan, work: () => Promise<T>): Promise<T> {
    if (active) throw Error("Avatar preservation connection is busy"); active = true; let begun = false;
    try {
      await options.verifyPrerequisites(plan.base);
      await db.query("BEGIN"); begun = true;
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [options.archiveSchema + ":avatar-preservation:" + plan.base.sourceNamespace]);
      await source(plan);
      const result = await work(); await db.query("COMMIT"); begun = false; return result;
    } catch (error) { if (begun) await db.query("ROLLBACK"); throw error; }
    finally { active = false; }
  }
  async function existing(plan: AvatarPreservationPlan): Promise<boolean> {
    const rows = (await db.query(`SELECT plan_sha256,receipt FROM ${archive}.avatar_preservation_receipts WHERE namespace=$1 FOR UPDATE`, [plan.base.sourceNamespace])).rows;
    if (!rows.length) return false;
    if (rows.length !== 1 || rows[0]!.plan_sha256 !== plan.sha256 || canonical(rows[0]!.receipt) !== canonical(receipt(plan))) throw Error("Avatar preservation receipt differs");
    return true;
  }
  return {
    async apply(input, mode) {
      const plan = immutableCopy(input);
      if (mode !== "initial" && mode !== "retry") throw Error("Explicit avatar amendment mode required");
      return transaction(plan, async () => {
        await db.query(`CREATE TABLE IF NOT EXISTS ${archive}.avatar_preservation_receipts(namespace text PRIMARY KEY,plan_sha256 text NOT NULL,receipt jsonb NOT NULL)`);
        const applied = await existing(plan);
        if (!applied && mode === "retry") throw Error("Avatar preservation receipt was removed or never applied");
        await accounts(plan, applied);
        if (applied) return { status: "already-applied" as const, receipt: receipt(plan) };
        for (const candidate of plan.candidates) {
          const current = (await db.query(`SELECT image FROM ${runtime}.accounts WHERE actor=$1`, [candidate.actor])).rows[0];
          if (current?.image === candidate.image) continue;
          const rows = (await db.query(`UPDATE ${runtime}.accounts SET image=$2 WHERE actor=$1 AND image IS NULL RETURNING actor`, [candidate.actor, candidate.image])).rows;
          if (rows.length !== 1) throw Error("Avatar account image changed during compare-and-set");
        }
        await db.query(`INSERT INTO ${archive}.avatar_preservation_receipts VALUES($1,$2,$3::jsonb)`, [plan.base.sourceNamespace, plan.sha256, JSON.stringify(receipt(plan))]);
        await accounts(plan, true);
        return { status: "applied" as const, receipt: receipt(plan) };
      });
    },
    async verify(input) {
      const plan = immutableCopy(input);
      return transaction(plan, async () => {
        const table = (await db.query("SELECT to_regclass($1) AS name", [options.archiveSchema + ".avatar_preservation_receipts"])).rows[0];
        if (!table?.name || !(await existing(plan))) throw Error("Avatar preservation receipt is unavailable");
        await accounts(plan, true); return receipt(plan);
      });
    },
  };
}
