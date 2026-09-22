---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; never fetch or call the site directly.
---
## Read first

artifactbin publishes agent-written documents people read, edit, annotate and share at a URL. An artifact is one `.jsx` file: a YAML fence for metadata, then self-contained static JSX — HTML prose and kit components styled with Tailwind via `className` — under a theme and a template. It queries datasets (CSV or JSON), embeds images and PDFs, and holds reader-changeable values, controls and charts; datasets and media are artifacts too.

Every action goes through the `afbin` CLI; the site's HTTP API is not for agents.

- Missing binary: `curl -fsSL [[ base ]]/chat/install.sh | sh`; it verifies the checksum.
- Sign-in is automatic. If remote/headless or browser login fails/times out, ask for email: `afbin auth --email <email>`. Ask for the code: `afbin auth --email <email> --otp <code>`, then retry. Credentials: `~/.artifactbin/hosts/<origin-id>/credentials.env`; never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit the file, `afbin push report.jsx`. For a new artifact, write the file and push it. Share its returned URL.
- Several people — shared, friends, a team, each person, sign-up, vote, RSVP, who did what: read `afbin help apps` BEFORE picking a data shape: accounts, never typed names.
- Few turns: `afbin help <template>`, then push a FIRST version within three calls of the pull — title and section headings, one line each — and fill the sections in later pushes; a person is waiting on a blank page. A successful push IS the verification: the head is your file. Skip pulling, diffing, exporting, screenshotting or grepping it afterwards; filling sections is not re-checking.
- Test every `<Mutation>` in a live session (`afbin help live-sessions`) on a test-user fork, as that user and yourself. On the original, check actions `--as guest`: identity writes offer Sign in and change no data. Fix, push and fork again until clean.
- Local files: `afbin add <files> --json` assigns reference IDs; preview/push auto-register named files. Push runs `afbin validate` and publishes unpublished IDs.
- Native markup first: the components cover text, data, charts, tables, controls and motion; use `<Iframe>` only for an isolated DOM script or canvas, never for layout or content.
- Preserve its identity: the CLI maintains `id`, `edit_id`, `head_version`, `state` and `version` in the YAML fence. Another artifact is a deliberate fork: copy the file and remove those five fields.
- Publishing is the check, whether or not you can view images; no other skill, palette tool or image tooling is needed — the theme carries the palette. To look, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image; never one slide at a time.
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write retry push to recover it.

`afbin -h` and `afbin help <topic>` work offline and print the references in `references/` beside it; bare `afbin help` prints this file's absolute location, so never search the filesystem.

## Example

Before writing, read design, markup, template and theme; a template's frame keeps content from sitting flush to the viewport edge. `afbin help <template>` prints every reference that kind needs.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md) — for anything a person judges by eye.
- [markup](references/markup.md) — the allowlist, Helmet, images, layout; then [data](references/markup-data.md) for queries, Values and charts.
- `afbin help templates` and `afbin help themes` list them; then `references/templates-<name>.md` and `references/themes-<name>.md` for the one picked.
- [sync and recovery](references/publishing.md) — status, diff, dry-run, force, uncertain writes.
- [errors](references/errors.md) — every refusal code and its fix.
- [comments](references/publishing-annotations.md) — `afbin comment` lists, answers and resolves threads.
- [apps](references/apps.md) — a page several people use.
- [datasets and media](references/publishing-datasets.md), [catalogs](references/databases.md), [user fields](references/databases-users.md), [queries](references/publishing-query.md).
- [history](references/publishing-versions.md) — `afbin log`, `afbin delete`, restore, export.
- [authentication](references/publishing-auth.md) — automatic sign-in, `--harness`, credentials per server.
- [live sessions](references/live-sessions.md) — Playwright, `mx`, screenshots.
- [commands](references/commands.md) — every command and flag; [Markdown import](references/markdown.md) for a one-time `.md` push.
