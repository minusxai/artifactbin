---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; never fetch or call the site directly.
---
## Read first

artifactbin publishes editable `.jsx` artifacts combining a YAML fence with self-contained HTML and kit JSX, styled with Tailwind `className`; the fence names its design system and page type. Datasets and media are artifacts too.

Use the `afbin` CLI through npm for local files and browser approval. Direct HTTP clients use the email-authenticated API.

- Prepare Node/npm once: `afbin_node_setup="$(mktemp)" && curl -fsSL [[ base ]]/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"`. Supported Node is reused; otherwise official LTS is installed for your user.
- Windows PowerShell: `Invoke-RestMethod [[ base ]]/chat/ensure-node.ps1 | Invoke-Expression`; use `npx.cmd` instead of `npx` below. No execution-policy change.
- Run every command through `npx --yes @artifactbin/cli@latest <command>`. Install skills with `npx --yes @artifactbin/cli@latest setup`. Pin an exact version for reproducibility. Prepare its npm cache while connected, then run `npm exec --offline --yes --package @artifactbin/cli@<version> -- afbin <command>` offline. npm executes with your permissions; it is not a sandbox.
- Local preview needs no credentials or cloud requests: `npx --yes @artifactbin/cli@latest preview report.jsx`. Source stays `.jsx`; offline downloads and HTML exports are self-contained `.jsx.html` files that open normally in a browser. Browser offline editing supports static markup/text; use local preview for compiler-dependent widgets. Publishing is explicit.
- CLI browser sign-in allows guests. Direct HTTP API sign-in requires email and cannot continue as a guest.
- Command examples below use `afbin` as shorthand: always invoke them as `npx --yes @artifactbin/cli@latest <command>` (Windows: `npx.cmd`).
- Sign-in is automatic via browser approval, even with `--yes`. If remote/headless or browser login fails/times out, ask for email: `afbin auth --email <email>`. Ask for the code: `afbin auth --email <email> --otp <code>`, then retry. Credentials: `~/.artifactbin/hosts/<origin-id>/credentials.env`; never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit the file, `afbin push report.jsx`. For a new artifact, write the file and push it. Share its returned URL.
- Several people — shared, friends, a team, each person, sign-up, vote, RSVP, who did what: read `afbin help apps` BEFORE picking a data shape: accounts, never typed names.
- Few turns: `afbin help <page type>`, ONE design system in the fence, then push a FIRST designed version within six calls of the pull — the fence, the title, real opening copy and one substantive section — and fill the rest in later pushes; a person is waiting on a blank page. A successful push IS the verification that source was accepted. Skip pulling, diffing or grepping it just to confirm publication; filling sections is not re-checking.
- For an existing artifact, prefer `afbin query ID --name tasks` to read and `afbin query ID --write --name change_status --param task_id=1 --param status=Done` to update. Use its declared names/arguments; preserve its source.
- Sessions are for browser/UI testing: newly authored actions, page-local state, row/cell action context. Test each new or changed `<Mutation>` in a live session (`afbin help live-sessions`) on each identity's isolated copy (`afbin help apps`) and on the original `--as guest` (identity writes off). One session at a time. Stop once each works once per identity.
- Local files: `afbin add <files> --json` assigns reference IDs; preview/push register named files. Push runs `afbin validate` and publishes unpublished IDs.
- Every body element has a persistent `id` for its lifetime. Move it with the same id; never reuse an id.
- Unlisted tags such as `<form>` are refused; read the markup allowlist.
- Markup for content, data and layout: the kit covers text, data, charts, tables, controls and motion. The Helmet `<script>` (Solid, any npm library) for behaviour; its exported components mount by name.
- Preserve its identity: the CLI maintains `id`, `edit_id`, `head_version`, `state` and `version` in the YAML fence. Another artifact is a deliberate fork: copy the file and remove those five fields.
- Publishing does not verify appearance, whether or not you can view images. For visual review, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image; never one slide at a time. For styling, no other skill, palette tool or image tooling is needed — the design system carries the palette and the type.
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write repeat the same command and arguments to recover it.

`afbin -h` and `afbin help <topic>` work offline; `afbin help` prints this file’s location.

## Example

Before writing, read `afbin help <page type>` for design and markup; skipping the frame leaves content flush to the viewport edge.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md) — visual design.
- [markup](references/markup.md) — allowlist and layout; then [data](references/markup-data.md) and its [worked example](references/markup-data-example.md).
- [page types](references/templates.md) — `afbin help templates` lists the seven, then `references/templates-<name>.md` for the one picked.
- [design systems](references/design-systems.md) — `afbin help design-systems`; pick one, then its `system-<slug>.md`; [worked briefs](references/worked-briefs.md) show the thesis.
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
