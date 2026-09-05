---
name: publishing-annotations
description: >-
  Comments pinned to the document: the anchor attribute to preserve, reply/resolve/reopen. Read before editing a document with open annotations.
order: 3
---
## Read first

Your user can select any node of a published document and attach a comment.
Comments are sidecar relations to the node's persistent BODY `id`: creating,
replying, resolving or reopening a comment does not rewrite the document,
stamp its source, flush an editor, or create a document version. Preserve the
node ID through edits and moves. Deleting that node or replacing it with a new
ID orphans its comments; never reuse the removed ID for different content.

Older documents may carry `data-annotation-anchor="<key>"`. That attribute is
legacy read compatibility, not the current authoring model: preserve an
existing value with its element, but never author, change or reuse one. New
comments do not add it.

Open annotations arrive INLINE on `GET [[ base ]]/api/artifacts/<id>`; when you
have acted on one (or have a question), answer it — reply, resolve, or both
in one call:

```
POST [[ base ]]/api/artifacts/<id>/annotations/<annotation_id>
{ "reply": "Recomputed from the Q3 sheet — it was 34%. Fixed.", "resolve": true }
→ 200 { "id", "status": "resolved", "thread": [ ... ] }
```

## The inline shape

```
"annotations": [ {
  "id": "ann_…", "status": "open",
  "snippet": "Revenue grew 40% in Q3",           ← the annotated node's text, as it reads NOW
  "quote": "grew 40% in Q3",                      ← the words they actually selected (null if none)
  "quote_found": true,                            ← are those words still in the document?
  "anchor": { "nodeId": "revenue-q3", "key": null, "path": "0.3", "spanStart": 812, "spanEnd": 964 },
  "anchor_version": 7,                            ← the version it was made against
  "orphaned": false,
  "thread": [ { "body": "this number looks wrong — check the Q3 sheet",
                "author": { "kind": "human", "label": "vivek", "transport": "browser" },
                "created_at": "…" } ]
} ]
```

Read them before editing. `quote` is the comment's subject — the exact words —
while `snippet` is the whole node they sit in, recomputed on every read;
`anchor.nodeId` tells you which current element that is (`id="revenue-q3"`).
On a historical thread it may be absent while `anchor.key` names an existing
legacy `data-annotation-anchor`; preserve that attribute but do not create one.
`"quote_found": false`
means those words are already gone from the current version. An
`"orphaned": true` annotation's node is not in the current version — the
snippet still says what it pointed at.

## Reply, resolve, reopen

A comment body is plain TEXT on the wire, and your user reads it through a
small markdown subset: `**bold**`, `_italic_`, `` `code` ``, fenced ``` blocks
(with a language), `-` and `1.` lists, `>` quotes, and `[label](url)` links to
`http`/`https`/`mailto` only. Write a reply the way you would write it in a
terminal — name files and identifiers in backticks and put a diff or a command
in a fence. Nothing else is interpreted: raw HTML and headings are shown as
the characters you typed, and `![alt](url)` is not an image — it renders as a
literal `!` followed by an ordinary link. A comment cannot embed a picture.

Over raw HTTP, send `Artifactbin-Agent: <your harness>` (`codex`,
`claude-code`, `chatgpt`, …) on the reply call, so the comment is signed with
your name instead of "Agent" — the header is display-only attribution and is
remembered on the token ([publishing-auth.md](publishing-auth.md)). An MCP
client needs nothing: `initialize.clientInfo` already named it.

`reply` alone keeps the thread open (say why, or ask back); `resolve` alone
closes silently; `{ "reopen": true }` returns a resolved thread to the open
list. A POST with none of `reply`, `resolve: true` or `reopen: true` is `400 invalid_annotation_action`;
a list `status` that is not `open`, `resolved` or `all` is `400 invalid_status`.
Resolved annotations leave the inline list;
`GET [[ base ]]/api/artifacts/<id>/annotations?status=all` shows history.

The threads themselves are server-held beside the document — your PUTs and
edits can never delete or alter a comment. Through MCP the same call is the
`annotate` tool.

Your user can delete a thread from their browser, and you cannot: there is no
delete door on this side, only reply, resolve and reopen. A deleted thread is
not erased — nothing in this product is — but there is no undo for it here
either, so treat one as gone and never offer to bring it back.
