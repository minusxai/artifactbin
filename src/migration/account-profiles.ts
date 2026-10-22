import { normalizeHandle, handleProblem } from "../server/handles.ts";
import { isPreservedNonloginActor } from "./identities.ts";
import type { LegacyRow, SqlReader } from "./contracts.ts";
import type { MigrationAccountProfileSummary } from "./account-profile-contracts.ts";
export function migrationHandleCandidate(value: unknown): {
  handle: string | null;
  status: "valid" | "missing" | "invalid";
} {
  if (value == null || value === "") return { handle: null, status: "missing" };
  const handle = normalizeHandle(value);
  return handleProblem(handle)
    ? { handle: null, status: "invalid" }
    : { handle, status: "valid" };
}
export function migrationPublicDisplayName(user: LegacyRow): string | null {
  if (typeof user.name === "string" && user.name) return user.name;
  // The archived username was public; its generator intentionally omitted the email domain.
  return typeof user.username === "string" &&
    /^[a-z0-9_]{3,32}$/.test(user.username)
    ? user.username
    : null;
}
/** Preserves current account edits; original public cards remain a separate immutable catalog. */
export async function projectMigrationAccountProfiles(
  db: SqlReader,
  users: readonly LegacyRow[],
  actors: Readonly<Record<string, string>>,
  initialImport = true,
): Promise<MigrationAccountProfileSummary> {
  const summary: MigrationAccountProfileSummary = {
    namesFilled: 0,
    namesPreserved: 0,
    namesUnavailable: 0,
    namesAbsentSinceImport: 0,
    handlesFilled: 0,
    handlesPreserved: 0,
    handlesMissing: 0,
    handlesInvalid: 0,
    handlesColliding: 0,
    handlesNonlogin: 0,
    handlesAbsentSinceImport: 0,
  };
  for (const user of users) {
    const actor = Object.hasOwn(actors, String(user.id))
      ? actors[String(user.id)]
      : undefined;
    if (!actor) continue;
    let account = (
      await db.query("SELECT name,handle FROM accounts WHERE actor=$1", [actor])
    ).rows[0];
    if (!account) throw Error("Mapped profile account is unavailable");
    const name = migrationPublicDisplayName(user);
    if (account.name !== null) summary.namesPreserved++;
    else if (!initialImport) summary.namesAbsentSinceImport++;
    else if (name !== null) {
      await db.query(
        "UPDATE accounts SET name=$2 WHERE actor=$1 AND name IS NULL",
        [actor, name],
      );
      summary.namesFilled++;
    } else summary.namesUnavailable++;
    if (isPreservedNonloginActor(actor)) {
      summary.handlesNonlogin++;
      continue;
    }
    if (account.handle !== null) {
      summary.handlesPreserved++;
      continue;
    }
    if (!initialImport) {
      summary.handlesAbsentSinceImport++;
      continue;
    }
    const candidate = migrationHandleCandidate(user.username);
    if (candidate.status === "missing") {
      summary.handlesMissing++;
      continue;
    }
    if (candidate.status === "invalid") {
      summary.handlesInvalid++;
      continue;
    }
    const result = await db.query(
      "UPDATE accounts SET handle=$2 WHERE actor=$1 AND handle IS NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE handle=$2) RETURNING handle",
      [actor, candidate.handle],
    );
    if (result.rows.length) summary.handlesFilled++;
    else {
      account = (
        await db.query("SELECT name,handle FROM accounts WHERE actor=$1", [
          actor,
        ])
      ).rows[0];
      if (account?.handle !== null && account?.handle !== undefined)
        summary.handlesPreserved++;
      else summary.handlesColliding++;
    }
  }
  return summary;
}
