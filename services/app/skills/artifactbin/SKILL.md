---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

Publish editable `.jsx`: YAML metadata, HTML and kit JSX with Tailwind `className`. Datasets/media.

[[ base ]]: use an already installed runnable CLI (`afbin`); otherwise use [HTTP](references/http-api.md) for remote creation/edits/comments/exports. npx downloads the CLI; it is not an installed CLI. CLI examples use `--server [[ base ]]`. Shared guides.

Setup: [[ base ]]/getting-started.md. Reuse skill or extract [[ base ]]/skills/artifactbin.zip into harness skills; restart. Without files: [[ base ]]/llms.txt. Download ≠ loading.

- Install CLI only when explicitly requested or needed for local preview/serve: [setup](references/npm-local.md).
- CLI chat/phone: ask email, `afbin auth --email <email>`, ask code, then `afbin auth --email <email> --otp <code>`. Automatic browser approval only on a shared desktop/request. Reuse origin-scoped credentials: `ARTIFACTBIN_HOME` or `~/.artifactbin`; [auth](references/http-auth.md). never mint or print tokens.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit, `afbin push report.jsx`. For a new artifact: CLI workspace or HTTP [authoring](references/http-authoring.md). Share returned URL. [[ urlReplyRule ]]
- Shared/friends/team/signup/vote/RSVP flows: read [apps](references/apps.md) BEFORE picking a data shape: accounts, never typed names.
- Read your [page type](references/templates.md); choose ONE design system. [[ progressiveAuthoringRule ]] Push confirms acceptance; do not reconfirm it.
- Use declared [queries](references/publishing-query.md) to read/update existing data; preserve source.
- QA changed actions/state: [live sessions](references/live-sessions.md), each identity’s isolated copy, then original `--as guest` (writes off). One session; each works once.
- Files: `afbin add <files> --json` assigns IDs. `afbin preview report.jsx` registers/runs until Ctrl+C; never `preview && push`. Push separately to validate/publish.
- Body `id`s persist: keep when moving; never reuse.
- Unlisted tags such as `<form>` are refused; read the markup allowlist.
- Long prose: `<Markdown>`; designed text: HTML.
- No CDN scripts; `<Helmet>` CSS/`<script>` (Solid/npm) for behaviour; exports mount by name.
- Preserve exactly the identity fields returned; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`. Fork: copy and remove `id`, `edit_id`, `head_version`, `state` and any `version`.
- Copy: short; preserve facts/caveats. [Copy](references/copy.md).
- Check numerical claims against query results: values, ratios and ranges must match. Chart comparisons encode every named series. Label assumptions about process/causes; never present them as dataset facts.
- Publishing does not verify appearance: one whole-document/all-slide `afbin export <artifact-url> --output out.png`. Files/IDs use local data; URL or `--refresh` uses server data. [Export](references/publishing-versions.md).
- [[ phoneAuthoringRule ]] (`afbin help live-sessions`).
- On refusal, follow its code/instruction. Conflicts preserve your file; after an uncertain write repeat the same command and arguments.

HTTP [graph fields](references/http-document-graph.md); same rules.

`afbin -h` / `afbin help <topic>`: offline. `afbin help`: this file’s location.

## Example

Keep viewport padding.

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
- [comments](references/publishing-annotations.md); posts/replies use `--agent <name>`; [monitoring](references/monitoring.md).
- [datasets and media](references/publishing-datasets.md), [catalogs](references/databases.md), [user fields](references/databases-users.md).
- [authentication](references/publishing-auth.md).
- [lambdas](references/lambdas.md).
- [commands](references/commands.md); [Markdown import](references/markdown.md).
