---
name: publishing-annotations
description: >-
  Comments pinned to the document: the anchor attribute to preserve, reply/resolve/reopen. Read before editing a document with open annotations.
order: 3
---
## Read first

Your user can select any node of a published document in their browser and
attach a comment. The commented node carries a `data-annotation-anchor="<key>"`
attribute in the markup — the value is only an opaque node key, never the
comment text. **That attribute IS the anchor. Preserve it when you edit:
keep it on the element it marks, move it with the content, and carry it
through full rewrites.** Deleting the node (or dropping the attribute)
orphans the comment; putting it back re-anchors it. Never add, change, or
reuse `data-annotation-anchor` values yourself.

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
  "anchor": { "key": "a1a2b3c4", "path": "0.3", "spanStart": 812, "spanEnd": 964 },
  "anchor_version": 7,                            ← the version it was made against
  "orphaned": false,
  "thread": [ { "body": "this number looks wrong — check the Q3 sheet",
                "author": { "kind": "human", "label": "vivek", "transport": "browser" },
                "created_at": "…" } ]
} ]
```

Read them before editing. `quote` is the comment's subject — the exact words —
while `snippet` is the whole node they sit in, recomputed on every read;
`anchor.key` tells you which node that is (find
`data-annotation-anchor="a1a2b3c4"` in the markup). `"quote_found": false`
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
list. A POST with none of the three is `400 invalid_annotation_action`.
Resolved annotations leave the inline list;
`GET [[ base ]]/api/artifacts/<id>/annotations?status=all` shows history.

The threads themselves are server-held beside the document — your PUTs and
edits can never delete or alter a comment; the ONLY annotation thing living
in the markup is the `data-annotation-anchor` key, which is yours to
preserve, never to author. Through MCP the same call is the `annotate` tool.
