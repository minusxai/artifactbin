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

## Edit a downloaded HTML file

Downloads and default HTML exports are named `<artifact-id>-<URL-slug>.jsx.html`, using the same ID and title slug as the artifact URL. The ID is also embedded inside the file; renaming a file does not change its identity. Explicit export paths and filenames already opened or chosen in Save are preserved.

Open a `.jsx.html` file in your browser. You can edit text and add comments without a server. **Save** or **Cmd/Ctrl+S** writes the updated HTML, including those comments. Chrome/Edge can show a native Save picker; later saves in the same tab write to the chosen file. Firefox/Safari download an updated copy. The receipt names the saved file. Your tab stays on the originally opened file: if you saved elsewhere, open the saved copy to continue there.

For the full local editor, start a preview server in the folder where you want the JSX copy. If `afbin` is not installed, run `npx --yes @afbin/cli@latest setup` once (Windows PowerShell: `npx.cmd --yes @afbin/cli@latest setup`); it installs the `afbin` command and the agent skills.

```sh
afbin preview --port 7474
```

In Windows PowerShell, use `afbin.cmd preview --port 7474`. In the HTML file, click **Connect to server**, enter `http://localhost:7474`, and click **Connect**. A server tab shows the document and comment count. Choose a workspace filename and click **Import and open**. Edits and comments then save through the existing local editor. The original HTML stays unchanged; its unsaved changes still need **Save** if you want to keep that standalone copy. You can also open the server directly and select **Import an HTML file**.

Connect accepts localhost or an HTTPS origin hosting the same preview service, including your own custom domain. Configure a reverse proxy's public origin with `preview --public-url https://preview.example.com`; `--share` separately controls network binding. Preview is a trusted workspace session, with the same selected-file access and conflict checks as normal preview. To send an offline edit back to an existing hosted artifact, use **Connect to server** and enter that artifactbin server’s HTTPS origin. Sign in if needed, review the recognized artifact, and click **Apply to original**. The server uses the embedded ID and its authenticated historical baseline; a filename is not proof of ownership. Independent concurrent edits can both succeed through the existing JSONB update guards. Overlapping edits report a conflict and keep your offline proposal. If the server cannot recognize or authorize the original, it never silently replaces it or creates a copy; an independent import must be chosen explicitly.

Connecting alone does not publish. Applying to a hosted artifact does; importing into a preview workspace stays local. The standalone HTML remains an independent copy and still needs **Save** to retain its own edits. Existing comment identities are retained, and newly added offline comments are attributed as unverified offline notes rather than impersonating another account.

The hosted handoff adds new offline notes and replies once. It does not overwrite the text or state of an existing server comment from an unauthenticated file snapshot; conflicting discussions are reported before applying the document. Keep the file and reconcile that discussion on the server.
