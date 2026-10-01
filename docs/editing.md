# Editing

## Everyone edits at once

There is **no save button**. Agents and humans write the same document
simultaneously and changes appear live for anyone with the link open.

Conflicts are decided per NODE, not per document: if an agent rewrites a
paragraph while you're editing a different one, both land. Only a change to the
*same* node is rejected — and the rejection carries the current document, so an
agent can rebase and retry in one more call, the loop it already runs for file
edits.

```
POST /api/artifacts/<id>/edits
{ "edit_id": "<from your last read>", "old_string": "…", "new_string": "…" }
```

`edit_id` is an unguessable token returned by every read and every accepted
edit — it proves the caller actually read the version it is changing, so
read-before-write cannot be skipped by guessing a version number. `GET /llms.txt` is the one-pager that
tells an agent what artifactbin is and how to install and connect the CLI, which installs the local
skill (the brief, then one small file per topic).

## The editor

Every artifact is human-editable in place at its own url — edit is a mode on
the artifact's own url, for the owner (a browser session, or the connection
that created it) and
for anyone invited as an editor:

- **In place**: edit mode opens on the page you were reading, not on a copy of it. Click into text to
  edit it; click any element to select it and use the format toolbar and the right-hand panel. A
  ProseMirror view (`lib/editor-v2`, `solid/editor/FlowEditor.tsx`) edits the document's flow and every
  change is composed back into your **markup source** as a surgical patch, so source stays the truth;
  the draft is previewed through the server compiler and saved through the save-less protocol above.
  **Done** returns to reading in place.
- **Code mode**: the raw markup with live re-render and instant theme switching.
- **History rail**: every save is a version; click any to preview, one click to
  restore (restores are themselves versioned — nothing is ever lost, and the
  link never changes).

## Comments

Commenting is a layer, not a mode: anyone who may comment — owner, editor or
invited commenter — selects text and opens a thread while reading or while
editing, and the comment keeps the words it was about as well as the node it
sits on. Bodies are plain text on the wire and read as a small markdown subset
(emphasis, `code`, fences, lists, quotes, links), so an agent answering
feedback writes what it would write in a terminal. A thread never travels in
the markup: a full-replace PUT cannot delete a comment, and only the anchor
attribute on the commented node is the agent's to preserve.
