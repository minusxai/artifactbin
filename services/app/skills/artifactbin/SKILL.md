---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

Publish editable `.jsx`: YAML metadata fence, self-contained HTML and kit JSX, Tailwind `className`. Datasets/media. Local/offline editing needs no remote API.

[% include workflows.introduction %]

## Authentication

[% include workflows.authentication %]

## Edit

[% include workflows.editing %]

## Create

[% include workflows.creation %]

Share its returned URL. [[ urlReplyRule ]]

## Authoring

- Shared/friends/team/signup/vote/RSVP flows: read [apps](references/apps.md) BEFORE data shape: accounts, never typed names.
- Read your [page type](references/templates.md); choose ONE design system. [[ progressiveAuthoringRule ]] [% if workflows.editing == "fragments/cli-editing.md" %][% include "fragments/cli-source-acceptance.md" %][% else %]An accepted edit saves source; it does not verify appearance.[% endif %]

- Every body element keeps its persistent `id` for its lifetime. Move with the same id; never reuse an id. Only allowlisted tags; no `<form>`.
- Use `<Markdown>` for long prose on any page type: headings, paragraphs and lists together; HTML for individually designed text.
- Use Helmet `<script>` (Solid, npm) for behaviour; exported components mount by name. No CDN scripts; `<Helmet>` holds CSS.
- Preserve exactly the identity fields returned; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`. Fork: remove `id`, `edit_id`, `head_version`, `state`, `version`.
- [Copy](references/copy.md): preserve facts/caveats. Check numerical claims against query results: values/ratios/ranges. Charts encode every named series. Label assumptions about process/causes; never dataset facts.
- Sessions are browser/UI QA for newly authored or changed `<Mutation>`, local state and row/cell context actions: [live sessions](references/live-sessions.md). Test each identity’s authorized isolated copy, then original [% if workflows.editing == "fragments/cli-editing.md" %]`--as guest`[% else %]as guest[% endif %] (writes off). One session at a time. Stop once each works once per identity.
- [[ phoneAuthoringRule ]]
- On refusal, follow instructions. Conflicts preserve files; after an uncertain write repeat the same command and arguments.

[% include workflows.operations %]

## Example

Keep content away from viewport edges.

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md).
- [markup](references/markup.md); [data](references/markup-data.md).
- Read `references/templates-<name>.md` BEFORE writing; [design systems](references/design-systems.md).
- [sync and recovery](references/publishing.md).
- [errors](references/errors.md).
- [Comments](references/publishing-annotations.md); [monitoring](references/monitoring.md).
- [datasets/media](references/publishing-datasets.md), [catalogs](references/databases.md), [lambdas](references/lambdas.md).
- [Commands](references/commands.md); [saved-view wireframes](references/review-state.md); [Markdown import](references/markdown.md).
