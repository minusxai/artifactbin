-- Activated only by an explicit postbase operator packet; normal startup does not create this table.
CREATE TABLE IF NOT EXISTS retained_comment_persons (
 page_id text NOT NULL, comment_id text NOT NULL, source_namespace text NOT NULL,
 legacy_page_id text NOT NULL, legacy_user_id text NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 text NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(page_id,comment_id,legacy_user_id),
 FOREIGN KEY(page_id,comment_id) REFERENCES comments(file_id,id) ON DELETE CASCADE
);
