---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; never fetch or call the site directly.
---
## Read first

artifactbin publishes agent-written documents that people read, edit, annotate and share at a URL. An artifact is one `.jsx` file: a YAML fence for metadata, then self-contained static JSX with HTML prose and kit components, styled with Tailwind classes via `className`, rendered under a theme and a template. It can query datasets (CSV or JSON files), embed images and PDFs, and hold reader-changeable values, controls and charts. Datasets, images and PDFs are artifacts too.

Every action goes through the `afbin` CLI; the site's HTTP API is not for agents.

- Missing binary: `curl -fsSL [[ base ]]/chat/install.sh | sh`; it verifies the release checksum.
- Authentication is automatic: afbin signs you in the first time a command needs the server — a quick browser approval, nothing to set up. In automation add `--yes --json` and it prints the approval URL to open, then continues once approved. Credentials are saved privately in `~/.artifactbin/.env`; never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit the file, `afbin push report.jsx`. For a new artifact, write the file and push it the same way. Share its returned URL as asked.
- Few turns, in this order: `afbin help <template>` (ONE call prints every reference you need, so read that instead of the files one by one), write the whole document, `afbin push`. Push runs `afbin validate` itself and publishes a referenced CSV with the document, so there is no separate validate, dry-run or dataset step; a refusal names the fix. A successful push IS the verification: the head is your file. Skip pulling, diffing, exporting, screenshotting or grepping it afterwards; to improve it, edit and push again.
- Preserve its identity: the CLI maintains `id`, `edit_id`, `head_version`, `state` and `version` in the YAML fence. Creating another artifact is a deliberate fork: copy the file and remove those five fields.
- Publishing is the check, whether or not you can view images; no other skill, palette tool or image tooling is needed — the theme carries the palette. If you must look, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image; never one slide at a time.
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write you retry push to recover its result.

`afbin -h`, `afbin <command> -h` and `afbin help <topic>` work offline and print the same references that sit in `references/` beside this file; bare `afbin help` prints this file's absolute location, so never search the filesystem for them.

## Example

Before writing a document, read design, markup, then the chosen template and theme (below); a template's frame keeps content from sitting flush to the viewport edge. `afbin help example` prints this file; `afbin help <template>` (dashboard, deck, editorial, plan, scrolly) prints every reference that kind of document needs, in one call.

```jsx
[[ example ]]
```

## Read next

Read only what the task needs, in this order for a new document:

- [design](references/design.md) — for any document a person will judge by eye.
- [markup](references/markup.md) — the component allowlist, Helmet, images, layout; then [data and controls](references/markup-data.md) for queries, Values, charts and KPI tiles.
- `afbin help templates` and `afbin help themes` list the choices; then `references/templates-<name>.md` and `references/themes-<name>.md` for the one picked.
- [sync and recovery](references/publishing.md) — status, diff, dry-run, force, retrying an uncertain write, node ids.
- [errors](references/errors.md) — every refusal code and its fix.
- [comments](references/publishing-annotations.md) — `afbin comment` lists, starts, answers and resolves threads.
- [datasets and media](references/publishing-datasets.md), [database catalogs](references/databases.md), [queries](references/publishing-query.md).
- [history and deletion](references/publishing-versions.md) — `afbin log`, `afbin delete`, restore, export.
- [authentication](references/publishing-auth.md) — how automatic sign-in works, `--harness`, credentials per server.
- [commands](references/commands.md) — every command and flag; [Markdown import](references/markdown.md) for a one-time `.md` push.
