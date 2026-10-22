import type { SqlClient } from "./sql.ts";
import type { CommentAttachment } from "../comment-attachment-contracts.ts";
/** Metadata is projected only inside the existing authorized comment read transaction. */
export async function commentAttachments(
  client: SqlClient,
  pageId: string,
  commentId?: string,
): Promise<Map<string, CommentAttachment[]>> {
  const rows = (
    await client.query(
      `SELECT a.* FROM comment_attachment_assets a JOIN comments c ON c.file_id=a.page_id AND c.id=a.comment_id WHERE a.page_id=$1 AND ($2::text IS NULL OR a.comment_id=$2) ORDER BY a.comment_id,a.attachment_id,a.variant`,
      [pageId, commentId ?? null],
    )
  ).rows;
  const result = new Map<string, CommentAttachment[]>();
  for (const row of rows) {
    let attachments = result.get(String(row.comment_id));
    if (!attachments) {
      attachments = [];
      result.set(String(row.comment_id), attachments);
    }
    let attachment = attachments.find((a) => a.id === row.attachment_id);
    if (!attachment) {
      attachment = {
        id: String(row.attachment_id),
        name: String(row.name),
        variants: [],
      };
      attachments.push(attachment);
    }
    (attachment.variants as Array<CommentAttachment["variants"][number]>).push({
      variant: row.variant as "original" | "preview" | "thumbnail",
      mimeType: "image/webp",
      width: Number(row.width),
      height: Number(row.height),
      bytes: Number(row.byte_length),
      sha256: String(row.sha256),
    });
  }
  return result;
}
