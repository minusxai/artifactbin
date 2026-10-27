---
name: comment-reactions
description: Account reaction metadata and idempotent reaction writes.
---
## Read first

Use the selected origin and its [email-authenticated account](http-auth.md). Read the [native comment list](html-operations.md) for root and reply IDs before reacting.

## Contents

- [Metadata](#metadata)
- [Set your reaction](#set-your-reaction)
- [Updates](#updates)

## Metadata

Each comment in `thread` includes `reactions`, grouped as `{kind,count,viewer_reacted}`. Counts are unique accounts per kind; `viewer_reacted` belongs to the current reader. No reactor identities are exposed. Signed-in accounts that can read the document may react, including viewers; inaccessible and deleted comments return the same 404.

## Set your reaction

Use `node scripts/comment.mjs react ID --comment COMMENT_ID --kind thumbs_up --active true` to add your own 👍, or `--active false` to remove it. The HTTP equivalent is `PUT /api/artifacts/ID/annotations/COMMENT_ID/reactions` with `{"kind":"thumbs_up","active":true}`. The comment ID may name a root or reply. The response is the updated whole thread. Desired state is idempotent: retry the same body after an uncertain response; never invert it to retry. Independent reaction kinds are modeled separately; only `thumbs_up` is accepted now.

## Updates

Reactions do not change source, comment text or thread revision and do not create human-comment feed events. Re-read the comment list for reaction metadata; hosted readers refresh through the existing comment live channel. Downloaded files show counts but stay read-only; open the original to react.

