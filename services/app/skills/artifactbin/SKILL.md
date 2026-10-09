---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

artifactbin publishes editable `.jsx`: a YAML fence, self-contained HTML and kit JSX with Tailwind `className`. Datasets/media too.

Server: [[ base ]]. Prefer an already installed runnable CLI; otherwise use [HTTP](references/http-api.md). Local preview/workspaces/npm need CLI/shell. Remote CLI commands use `--server [[ base ]]`. CLI `help <topic>` and linked references share guidance; HTTP reads links. Commands below are CLI examples.

Setup: [[ base ]]/getting-started.md. Reuse the skill or extract [[ base ]]/skills/artifactbin.zip into the harness skill directory; restart. Without files read [[ base ]]/llms.txt. Download ≠ loading.

- Install CLI only when the user requests CLI or the operation needs local CLI (preview/workspace/serve). If `afbin` is missing: run `npx --yes @afbin/cli@latest setup --server '[[ base ]]'` (Windows: `npx.cmd --yes @afbin/cli@latest setup --server '[[ base ]]'`); installs command/skill. [Setup details](references/npm-local.md).
- CLI chat/phone: ask email, run `afbin auth --email <email>`, ask code, then `afbin auth --email <email> --otp <code>`. Automatic browser approval only on a shared desktop or request. Reuse the origin-scoped credentials under `ARTIFACTBIN_HOME` or `~/.artifactbin`; [authentication](references/http-auth.md). never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit, `afbin push report.jsx`. For a new artifact, CLI uses an afbin workspace; HTTP uses [authoring](references/http-authoring.md). Share its returned URL. [[ urlReplyRule ]]
- Shared/friends/team/signup/vote/RSVP flows: read `afbin help apps` BEFORE picking a data shape: accounts, never typed names.
- Read `afbin help <page type>` and choose ONE design system. [[ progressiveAuthoringRule ]] Push confirms acceptance; do not reconfirm it.
- For an existing artifact, prefer `afbin query ID --name tasks` to read and `afbin query ID --write --name change_status --param task_id=1 --param status=Done` to update. Use its declared names/arguments; preserve its source.
- QA changed actions/state in [live sessions](references/live-sessions.md): each identity's isolated copy, then original `--as guest` (writes off). One session; each works once.
- Files: `afbin add <files> --json` assigns IDs. `afbin preview report.jsx` registers files and runs until Ctrl+C; never `preview && push`. Push separately; it validates/publishes.
- Every body element has a persistent `id`: retain it when moving; never reuse it.
- Unlisted tags such as `<form>` are refused; read the markup allowlist.
- Use `<Markdown>` for long prose; keep headings, paragraphs and lists together. Use HTML for individually designed text.
- No CDN scripts; use `<Helmet>` CSS and `<script>` (Solid/npm) for behaviour; exports mount by name.
- Preserve exactly the identity fields returned in the YAML fence; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`. Fork: copy and remove `id`, `edit_id`, `head_version`, `state` and any `version`.
- Copy: plain/short; preserve facts/caveats. [Copy guidance](references/copy.md).
- Publishing does not verify appearance: one whole-document/all-slide `afbin export <artifact-url> --output out.png`. Files/IDs use local data; published URL or `--refresh` uses server data. [Export](references/publishing-versions.md).
- [[ phoneAuthoringRule ]] (`afbin help live-sessions`).
- On refusal, follow the returned code and instruction; a conflict never touches your file, and after an uncertain write repeat the same command and arguments to recover it.

HTTP [graph fields](references/http-document-graph.md); same rules.

`afbin -h` and `afbin help <topic>` work offline; `afbin help` prints this file’s location.

## Example

Read `afbin help <page type>` before writing; keep viewport padding.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md).
- [markup](references/markup.md); [data](references/markup-data.md) and [example](references/markup-data-example.md).
- [uploads](references/markup-upload.md).
- [page types](references/templates.md), [design systems](references/design-systems.md), [worked briefs](references/worked-briefs.md).
- [sync and recovery](references/publishing.md).
- [errors](references/errors.md).
- [comments](references/publishing-annotations.md); posts/replies use `--agent <name>`.
- [apps](references/apps.md).
- [datasets and media](references/publishing-datasets.md), [catalogs](references/databases.md), [user fields](references/databases-users.md), [queries](references/publishing-query.md).
- [history](references/publishing-versions.md).
- [authentication](references/publishing-auth.md).
- [lambdas](references/lambdas.md).
- [live sessions](references/live-sessions.md).
- [commands](references/commands.md); [Markdown import](references/markdown.md).
