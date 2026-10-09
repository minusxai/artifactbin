---
name: publishing-versions
description: "Rules and invocations for publishing versions."
---
## Read first

History includes the current head. Add @version to pull or diff; log starts at that version or earlier. Delete retains local files and forgets the returned subtree identities. Repeating an owned deletion is safe. Revert by pulling ref@version and pushing conditionally; restore with push --restore; export with export.

## Screenshot / export

PNG/JPG export renders local JSX files and locally registered IDs with the preview runtime and Chromium, without publishing or changing source. Registered ID dependencies use local dataset files, which do not automatically receive server mutations. Other IDs and explicit artifact URLs use server rendering. `--refresh` on a published artifact ID or URL selects server rendering and waits for a fresh image; local file paths are refused. Drop `--refresh` to render local bytes, or use the published artifact URL. To review the published page and its current datasets after a push or server run, export its artifact URL, or its published ID with `--refresh`. `--format html` saves the offline file: one self-contained `.jsx.html` that opens, edits and comments without a connection. Local JSX files and registered local IDs need no published head; remote references export their server snapshot.

## An older version

`afbin export <id>@2 --format png` photographs THAT version's page rather than the head; `--format html` saves that version's offline file. A local file has no history: `report.jsx@2` is refused, because the tracked bytes on disk are the head.

The same view opens in a browser at `/a/<id>?version=2` — read-only, under a fixed "Version 2 of 7 · read-only" line, with no editing, no commenting and every `<Mutation>` refused. Only the owner and named editors may open it; for anyone else that address is not found, whatever they may read of the document itself. Drive it in a live session with `page.goto('/a/<id>?version=2')` (`afbin help live-sessions`).

A successful push is the check that source was accepted: the head is exactly the file you pushed. It does not verify appearance. For visual review, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image — never one slide at a time.

That covers the markup and the read queries; it says nothing about a write. A page carrying a `<Mutation>` is not finished until each write has run once in a live session as yourself and once `--as guest` (`afbin help live-sessions`), and a page several people use is built from `afbin help apps`.

## Social preview

The card a link unfurls is set in the document itself, by `<meta>` tags inside `<Helmet>`, pushed like any other source. `<meta name="artifactbin:og-image" content="ref:<imageId>" />` names the card image (publish it first with `afbin push cover.png`); `<meta name="artifactbin:og-crop" content="x=0;y=0;width=1600" />` frames the document shot instead — 40:21 out of a 1600px-wide layout, width 400–1600; `<meta name="artifactbin:og-image-crop" content="x=0;y=0;width=1600" />` takes the same `x;y;width` on the named image. Omit them all for the default full-width framing.

## List your artifacts

`afbin list` includes datasets and media, not only documents. Each item names its format; use --limit and --cursor for pages.

## Trash, folders and visibility

Delete is a trash: artifacts are restorable with no deadline using push --restore <id>. Deleted content still counts against your quota. Actual erasure is an administrative act on the database, outside this API. A restore can land a row deeper than the 6-level cap. An unlisted artifact is excluded from public listings, a folder page included; owners can still see their own artifacts.

A folder has no content: its page is an app listing. Only title, visibility and folder are editable, through folder YAML. Do not push JSX to a folder.
