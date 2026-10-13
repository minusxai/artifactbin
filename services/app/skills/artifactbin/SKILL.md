---
name: artifactbin
description: >-
  Required for every artifactbin task: any artifactbin.dev or self-hosted artifactbin link, any afbin command, and any request to publish, edit, comment on, query or export an artifact, document, dashboard, deck or dataset. Read this skill before acting; use the documented npm CLI or authenticated HTTP API contracts.
---
## Read first

Publish editable `.jsx`: YAML metadata fence, self-contained HTML and kit JSX, Tailwind `className`. Datasets/media. Local/offline editing needs no remote API.

[% include workflows.introduction %]

## Contents

[Authentication](#authentication) · [Edit](#edit) · [Create](#create) · [Authoring](#authoring) · [Example](#example) · [References](#read-next)

## Authentication

[% include workflows.authentication %]

## Edit

[% include workflows.editing %]

## Create

[% include workflows.creation %]

[[ urlReplyRule ]]

## Authoring

- Multi-user flows: read [apps](references/apps.md) BEFORE data shape; use accounts.
- Read your [page type](references/templates.md); choose ONE design system. [[ progressiveAuthoringRule ]]
- Preserve source and element IDs across edits/moves; never reuse an ID. Only allowlisted tags; no `<form>`.
- Use `<Markdown>` for long prose; HTML for individually designed text.
- Preserve exactly the identity fields returned; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`.
- [Copy](references/copy.md): preserve facts/caveats. Check numerical claims against query results: values/ratios/ranges. Charts encode every named series. Label assumptions about process/causes; never dataset facts.
- Changed interactions: [live sessions](references/live-sessions.md). Test authorized copies per identity, then original as guest (writes off); one session at a time.
- [[ phoneAuthoringRule ]]
- On refusal, follow instructions. Conflicts preserve files; after an uncertain write repeat the same command and arguments.

[% include workflows.operations %]

## Example

```jsx
[[ example ]]
```

## Read next

- [design](references/design.md).
- [markup](references/markup.md); [data](references/markup-data.md).
- [Design systems](references/design-systems.md).
- [sync and recovery](references/publishing.md).
- [errors](references/errors.md).
- [Comments](references/publishing-annotations.md); [monitoring](references/monitoring.md).
- [datasets/media](references/publishing-datasets.md), [catalogs](references/databases.md), [lambdas](references/lambdas.md).
- [Commands](references/commands.md); [Markdown import](references/markdown.md).
