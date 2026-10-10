---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

Publish editable `.jsx`: YAML metadata fence, self-contained HTML and kit JSX, Tailwind `className`. Datasets/media. Local/offline editing needs no remote API.

[[ base ]]: use an already installed runnable CLI (`afbin`); otherwise use [HTTP](references/http-api.md). npx downloads the CLI; not installed. CLI: `--server [[ base ]]`. HTTP: ask email, request auth, ask emailed OTP and wait for the user’s reply before verification; [auth](references/http-auth.md).

Setup: [[ base ]]/getting-started.md. Load skill or [[ base ]]/skills/artifactbin.zip; restart. No files: [[ base ]]/llms.txt. Download ≠ load.

- Install CLI only when requested or needed for local preview/serve: [setup](references/npm-local.md).
- `afbin status`: saved state (last observed, no login); `afbin auth status` is not a status command.
- CLI chat: ask email, `afbin auth --email <email>`, ask code, `afbin auth --email <email> --otp <code>`. Automatic browser approval only on shared desktop/request. Reuse origin-scoped credentials ([auth](references/publishing-auth.md)); never mint or print tokens.
- Group setup/defaults: [groups](references/groups.md); select the recipient’s group with `setup --server [[ base ]] --group <handle> --set-default`. New artifacts inherit destination; defaults never transfer existing artifacts.
- For a supplied artifact: `afbin pull <url-or-id> --output report.jsx`, edit, `afbin push report.jsx`. For a new artifact: CLI or HTTP [authoring](references/http-authoring.md). Share its returned URL. [[ urlReplyRule ]]
- Shared/friends/team/signup/vote/RSVP flows: read [apps](references/apps.md) BEFORE data shape: accounts, never typed names.
- Read your [page type](references/templates.md); choose ONE design system. [[ progressiveAuthoringRule ]] Push confirms source acceptance; do not pull, diff or grep just to reconfirm it.
- Existing artifacts: prefer named [queries](references/publishing-query.md); preserve source. CLI: `afbin query ID --name tasks`; `afbin query ID --write --name change_status`. Inspect params.
- Sessions are browser/UI QA for newly authored or changed `<Mutation>`, local state and row/cell context actions: [live sessions](references/live-sessions.md). Test each identity’s authorized isolated copy, then original `--as guest` (writes off). One session at a time. Stop once each works once per identity.
- CLI: `afbin add <files> --json` assigns IDs; `afbin preview report.jsx` runs until Ctrl+C, never `preview && push`. Push validates/publishes.
- Every body element has a persistent `id` for its lifetime. Move with the same id; never reuse an id.
- Unlisted tags (`<form>`) are refused; read the allowlist.
- Use `<Markdown>` for long prose on any page type: headings, paragraphs and lists together; HTML for individually designed text.
- Use Helmet `<script>` (Solid, npm) for behaviour; exported components mount by name. No CDN scripts; `<Helmet>` holds CSS.
- Preserve exactly the identity fields returned; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`. Fork: remove `id`, `edit_id`, `head_version`, `state`, `version`.
- Short [copy](references/copy.md); preserve facts/caveats.
- Check numerical claims against query results: values/ratios/ranges. Charts encode every named series. Label assumptions about process/causes; never dataset facts.
- Publishing does not verify appearance: one whole-document/all-slide export. CLI `afbin export <artifact-url> --output out.png`; URL/`--refresh` uses server, files/IDs local. [Export](references/publishing-versions.md).
- [[ phoneAuthoringRule ]] (`afbin help live-sessions`).
- On refusal, follow instructions. Conflicts preserve files; after an uncertain write repeat the same command and arguments.

HTTP [graph](references/http-document-graph.md); same rules.

Reference: afbin help. `afbin -h` / `afbin help <topic>`: offline. `afbin help`: this file’s location.

## Example

Keep content away from viewport edges.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md).
- [markup](references/markup.md); [data](references/markup-data.md).
- [page types](references/templates.md): read `references/templates-<name>.md` BEFORE writing. [design systems](references/design-systems.md).
- [sync and recovery](references/publishing.md).
- [errors](references/errors.md).
- [comments](references/publishing-annotations.md); posts/replies use `--agent <name>`; [monitoring](references/monitoring.md).
- [datasets/media](references/publishing-datasets.md), [catalogs](references/databases.md), [lambdas](references/lambdas.md).
- [commands](references/commands.md); [saved-view wireframes](references/review-state.md); [Markdown import](references/markdown.md).
