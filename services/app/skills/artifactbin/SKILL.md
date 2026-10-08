---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

artifactbin publishes editable `.jsx`: a YAML fence, self-contained HTML and kit JSX with Tailwind `className`. Datasets/media are artifacts too.

npm CLI: local files/browser approval. Email login required for CLI and HTTP; [HTTP API](references/http-api.md).

- If `afbin` is not installed, run `npx --yes @afbin/cli@latest setup` once (Windows PowerShell: `npx.cmd --yes @afbin/cli@latest setup`); it installs the `afbin` command and the agent skills. [Setup details](references/npm-local.md).
- Local preview: `.jsx.html`.
- Automatic browser approval also applies to `--yes`. If unavailable, ask for email: `afbin auth --email <email>`; then code: `afbin auth --email <email> --otp <code>`. Credentials: `~/.artifactbin/hosts/<origin-id>/credentials.env`; never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit, `afbin push report.jsx`. For a new artifact, write and push; keep the file in an afbin workspace (at or under a directory with `.artifactbin/`; discovery walks up parents), never a temp directory. Share its returned URL. [[ urlReplyRule ]]
- Shared/friends/team/signup/vote/RSVP flows: read `afbin help apps` BEFORE picking a data shape: accounts, never typed names.
- Read `afbin help <page type>` and choose ONE design system. [[ progressiveAuthoringRule ]] Push confirms source acceptance; do not pull, diff or grep just to reconfirm it.
- For an existing artifact, prefer `afbin query ID --name tasks` to read and `afbin query ID --write --name change_status --param task_id=1 --param status=Done` to update. Use its declared names/arguments.
- Sessions are browser/UI QA for newly authored or changed `<Mutation>`, page-local state and row/cell actions. Use a live session (`afbin help live-sessions`) on each identity's isolated copy (`afbin help apps`), then the original `--as guest` (identity writes off). One session at a time. Stop once each works once per identity.
- Files: `afbin add <files> --json` assigns IDs; preview/push register files. Preview runs until Ctrl+C; never `preview && push`. Push separately; it validates and publishes.
- Every body element keeps a persistent `id`: move it with the same id; never reuse one.
- Unlisted tags such as `<form>` are refused; read the markup allowlist.
- The kit covers content, layout, data, charts, tables, controls, motion. Use Helmet `<script>` (Solid, npm) for behaviour; exported components mount by name.
- Preserve its identity: keep `id`, `edit_id`, `head_version`, `state` and `version` in the YAML fence. Fork: copy and remove those five fields.
- Copy: plain words, short sentences; preserve facts and caveats. [Copy guidance](references/copy.md).
- Publishing does not verify appearance. For visual review, one `afbin export <ref> --output out.png` shows the whole document, every slide, in one image; never one slide at a time. Files/registered IDs use local data, unchanged by server mutations. Published data: `afbin export <artifact-url> --output out.png` or ID with `--refresh` (fresh published image; refuses local paths). For styling, no other skill, palette tool or image tooling is needed — the design system carries the palette and type.
- [[ phoneAuthoringRule ]] (`afbin help live-sessions`).
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write repeat the same command and arguments to recover it.

`afbin -h` and `afbin help <topic>` work offline; `afbin help` prints this file’s location.

## Example

Avoid content flush to the viewport edge.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md) — visual design.
- [markup](references/markup.md); [data](references/markup-data.md) and [example](references/markup-data-example.md).
- [uploads](references/markup-upload.md).
- [page types](references/templates.md) — `afbin help templates`, then `references/templates-<name>.md`.
- [design systems](references/design-systems.md) — `afbin help design-systems`, then `system-<slug>.md`; [worked briefs](references/worked-briefs.md).
- [sync and recovery](references/publishing.md).
- [errors](references/errors.md) — refusal codes and fixes.
- [comments](references/publishing-annotations.md) — `afbin comment --agent <name>` for posts/replies.
- [apps](references/apps.md) — shared pages; interactive wireframes: `afbin help review-state`.
- [datasets and media](references/publishing-datasets.md), [catalogs](references/databases.md), [user fields](references/databases-users.md), [queries](references/publishing-query.md).
- [history](references/publishing-versions.md) — `afbin log`, `afbin delete`, restore, export.
- [authentication](references/publishing-auth.md) — sign-in and credentials.
- [lambdas](references/lambdas.md).
- [live sessions](references/live-sessions.md) — Playwright, `mx`, screenshots.
- [commands](references/commands.md); [Markdown import](references/markdown.md) for a one-time `.md` push.
