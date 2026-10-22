import type { SqlClient, SqlDatabase } from "../persistence/sql.ts";
import type {
  CommentBodyPresentation,
  CommentPersonLink,
} from "./presentation-contracts.ts";
import type {
  RetainedCommentPersonPlan,
  RetainedCommentPersonVerification,
} from "./retained-person-contracts.ts";
import { commentBodySha256 } from "./retained-persons.ts";
import { canonicalPersonHref, personMentionIds } from "./presentation.ts";
/** Read-only verification works inside a READ ONLY transaction. Apply alone takes locks. */
async function inspectRetainedCommentPersons(
  client: SqlClient,
  plan: RetainedCommentPersonPlan,
  apply = false,
): Promise<RetainedCommentPersonVerification> {
  if (plan.format !== 1 || plan.entries.length > 100)
    throw Error("Invalid retained comment person plan");
  let mentions = 0,
    present = 0;
  for (const entry of plan.entries) {
    const row = (
      await client.query(
        `SELECT c.body FROM comments c JOIN files f ON f.id=c.file_id WHERE c.file_id=$1 AND c.id=$2${apply ? " FOR SHARE OF c,f" : ""}`,
        [entry.pageId, entry.commentId],
      )
    ).rows[0];
    if (
      !row ||
      commentBodySha256(String(row.body)) !== entry.bodySha256 ||
      JSON.stringify(personMentionIds(String(row.body))) !==
        JSON.stringify(entry.legacyUserIds)
    )
      throw Error("Retained comment no longer matches its evidence");
    for (const user of entry.legacyUserIds) {
      mentions++;
      const principal = (
        await client.query(
          "SELECT actor FROM dataset_principals WHERE source_namespace=$1 AND kind='user' AND legacy_id=$2",
          [entry.sourceNamespace, user],
        )
      ).rows;
      if (principal.length !== 1)
        throw Error("Retained comment principal is unavailable");
      if (apply)
        await client.query(
          `INSERT INTO retained_comment_persons(page_id,comment_id,source_namespace,legacy_page_id,legacy_user_id,body_sha256,archive_sha256,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            entry.pageId,
            entry.commentId,
            entry.sourceNamespace,
            entry.legacyPageId,
            user,
            entry.bodySha256,
            entry.archiveSha256,
            entry.receiptSha256,
          ],
        );
      const saved = (
        await client.query(
          "SELECT * FROM retained_comment_persons WHERE page_id=$1 AND comment_id=$2 AND legacy_user_id=$3",
          [entry.pageId, entry.commentId, user],
        )
      ).rows[0];
      if (saved) {
        if (
          saved.source_namespace !== entry.sourceNamespace ||
          saved.legacy_page_id !== entry.legacyPageId ||
          saved.body_sha256 !== entry.bodySha256 ||
          saved.archive_sha256 !== entry.archiveSha256 ||
          saved.receipt_sha256 !== entry.receiptSha256
        )
          throw Error("Retained comment person receipt conflicts");
        present++;
      }
    }
  }
  return { entries: plan.entries.length, mentions, present };
}
/** Caller already authorizes the page; this only projects public current handles, never author identity data. */
export async function projectCommentPersons<
  T extends CommentBodyPresentation & { id: string },
>(
  client: SqlClient,
  pageId: string,
  comments: readonly T[],
): Promise<(T & CommentBodyPresentation)[]> {
  // Projection is rebuilt from current authority; never preserve a cached or caller-supplied mapping.
  comments = comments.map((comment) => {
    const clean = { ...comment };
    delete clean.personLinks;
    return clean;
  });
  if (!comments.some((comment) => personMentionIds(comment.body).length))
    return [...comments];
  // An unapplied postbase packet has no mapping. Do not catch unrelated database errors.
  if (
    !(
      await client.query(
        "SELECT to_regclass(current_schema() || '.retained_comment_persons') AS relation",
      )
    ).rows[0]?.relation
  )
    return [...comments];
  const rows = (
    await client.query(
      `SELECT m.comment_id,m.legacy_user_id,m.body_sha256,a.handle FROM retained_comment_persons m JOIN comments c ON c.file_id=m.page_id AND c.id=m.comment_id JOIN files f ON f.id=c.file_id JOIN dataset_principals p ON p.source_namespace=m.source_namespace AND p.kind='user' AND p.legacy_id=m.legacy_user_id JOIN accounts a ON a.actor=p.actor WHERE m.page_id=$1 AND m.comment_id=ANY($2::text[])`,
      [pageId, comments.map((c) => c.id)],
    )
  ).rows;
  return comments.map((comment) => {
    const hash = commentBodySha256(comment.body),
      ids = new Set(personMentionIds(comment.body));
    const personLinks: CommentPersonLink[] = [];
    for (const row of rows) {
      if (
        row.comment_id !== comment.id ||
        row.body_sha256 !== hash ||
        !ids.has(String(row.legacy_user_id))
      )
        continue;
      const href = canonicalPersonHref("/@" + String(row.handle));
      if (href)
        personLinks.push({ legacyUserId: String(row.legacy_user_id), href });
    }
    return { ...comment, ...(personLinks.length ? { personLinks } : {}) };
  });
}

export function verifyRetainedCommentPersons(
  client: SqlClient,
  plan: RetainedCommentPersonPlan,
): Promise<RetainedCommentPersonVerification> {
  return inspectRetainedCommentPersons(client, plan);
}
/** All entries commit together; a conflicting receipt or body rolls back the entire packet. */
export function applyRetainedCommentPersons(
  database: SqlDatabase,
  plan: RetainedCommentPersonPlan,
): Promise<RetainedCommentPersonVerification> {
  return database.transaction((client) =>
    inspectRetainedCommentPersons(client, plan, true),
  );
}
