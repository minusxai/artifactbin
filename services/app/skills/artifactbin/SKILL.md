---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; never fetch or call the site directly.
---
## Read first

artifactbin publishes editable `.jsx` artifacts combining a YAML fence with self-contained HTML and kit JSX, styled with Tailwind `className`, a theme and template. Datasets and media are artifacts too.

Every action goes through the `afbin` CLI; the site's HTTP API is not for agents.

- Missing binary: `curl -fsSL [[ base ]]/chat/install.sh | sh`; it verifies the checksum.
- Windows x64: download `[[ base ]]/chat/install.ps1`, then run it in PowerShell with `-Yes`. Reopen the terminal. Close afbin and rerun it to upgrade.
- Sign-in is automatic via browser approval, even with `--yes`. If remote/headless or browser login fails/times out, ask for email: `afbin auth --email <email>`. Ask for the code: `afbin auth --email <email> --otp <code>`, then retry. Credentials: `~/.artifactbin/hosts/<origin-id>/credentials.env`; never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit the file, `afbin push report.jsx`. For a new artifact, write the file and push it. Share its returned URL.
- Several people — shared, friends, a team, each person, sign-up, vote, RSVP, who did what: read `afbin help apps` BEFORE picking a data shape: accounts, never typed names.
- Few turns: `afbin help <template>`, then push a FIRST version within three calls of the pull — title and section headings, one line each — and fill the sections in later pushes; a person is waiting on a blank page. A successful push IS the verification that source was accepted. Skip pulling, diffing or grepping it just to confirm publication; filling sections is not re-checking.
- For an existing artifact, prefer `afbin query ID --name tasks` to read and `afbin query ID --write --name change_status --param task_id=... --param status=...` to update. Use its declared names/arguments; preserve its source.
- Use sessions for browser/UI testing of newly authored actions, page-local state and unsupported row/cell action context. Test every newly authored or changed `<Mutation>` in a live session (`afbin help live-sessions`) on each identity’s isolated copy (`afbin help apps`). On the original, `--as guest`: identity writes stay disabled and change no data. One session at a time. Stop once each works once per identity.
- Local files: `afbin add <files> --json` assigns reference IDs; preview/push auto-register named files. Push runs `afbin validate` and publishes unpublished IDs.
- Every body element has a persistent `id` for its lifetime. Move it with the same id; never reuse an id.
- Unlisted tags such as `<form>` are refused; read the markup allowlist.
- Markup for content, data and layout: the kit covers text, data, charts, tables, controls and motion. The Helmet `<script>` (Solid, any npm library) for behaviour; its exported components mount by name.
- Preserve its identity: the CLI maintains `id`, `edit_id`, `head_version`, `state` and `version` in the YAML fence. Another artifact is a deliberate fork: copy the file and remove those five fields.
- Publishing does not verify appearance, whether or not you can view images. For visual review, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image; never one slide at a time. For styling, no other skill, palette tool or image tooling is needed — the theme carries the palette.
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write repeat the same command and arguments to recover it.

`afbin -h` and `afbin help <topic>` work offline; `afbin help` prints this file’s location.

## Example

Before writing, read `afbin help <template>` for design, markup, template and theme; skipping the frame leaves content flush to the viewport edge.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md) — visual design.
- [markup](references/markup.md) — allowlist and layout; then [data](references/markup-data.md) and its [worked example](references/markup-data-example.md).
- `afbin help templates` and `afbin help themes` list them; then `references/templates-<name>.md` and `references/themes-<name>.md` for the one picked.
- [sync and recovery](references/publishing.md) — status, diff, dry-run, force, uncertain writes.
- [errors](references/errors.md) — refusal codes and fixes.
- [comments](references/publishing-annotations.md) — `afbin comment`; `afbin help remote-review`.
- [apps](references/apps.md) — shared pages, grants, mentions.
- [datasets and media](references/publishing-datasets.md), [catalogs](references/databases.md), [user fields](references/databases-users.md), [queries](references/publishing-query.md).
- [history](references/publishing-versions.md) — `afbin log`, `afbin delete`, restore, export.
- [authentication](references/publishing-auth.md) — sign-in and credentials.
- [lambdas](references/lambdas.md).
- [live sessions](references/live-sessions.md) — Playwright, `mx`, screenshots.
- [commands](references/commands.md) — every command and flag; [Markdown import](references/markdown.md) for a one-time `.md` push.
