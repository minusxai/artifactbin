---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing page or app. Use the author skill and authenticated HTTP API contracts.
---
## Read first

Artifactbin is a store for publishing self-contained HTML + kit JSX apps. It provides essential infrastructure for agents to make collaborative, token efficient and beautiful tiny applications. It provides a surface for humans and agents to express ideas, and for teammates to provide specific, rich feedback.

The basic premise of Artifactbin is that it uses declarative markup, which means that our provided components and design systems can offer powerful features via tiny syntax (stateful commenting, rich viz, data mutations, out of the box beauty, etc.) Artifactbin has a LOT of features, but reading everything is not necessary for every action. Here's a routine that can be followed to get the most relevant information, the fastest. Some common scenarios listed at the end should also help.

## Routine
0. [Understand user need](#0-understand-user-need)
1. [Get connected](#1-get-connected)
2. [Understand create and edit](#2-understand-create-and-edit)
3. [Shape the content](#3-shape-the-content)
4. [Save, share and verify](#4-save-share-and-verify)
5. [Reference tree](#reference-tree)

## 0. Understand user need
If the users' need is not clear, or the purpose/contents or the artifact you're building are not clear, ask the user to clarify!

## 1. Get connected
BaseURL: [[ base ]]
Use the authenticated HTTP API and reuse saved credentials for this origin. Missing credentials do not mean a new user.

[% include workflows.introduction %]

### Authentication

[% include workflows.authentication %]

Note: Public reads and local-only authoring need no login.

## 2. Understand create and edit

[% if transport == "http" %]Publish self-contained HTML and kit JSX in JSON `markup` (create) or `source` (prepare). Metadata belongs in JSON request fields. Do not send a YAML metadata fence.[% else %]Publish editable `.jsx`: a YAML metadata fence followed by self-contained HTML and kit JSX.[% endif %] Style elements with Tailwind utilities using `className`, for example `className="px-6 py-8"`.

Bind components to a named query's rows with `data="$name"`, declared with `<Query>` in `<Helmet>` over a dataset. See [data markup](references/markup-data.md).

Use Helmet `<script>` (Solid, npm) for behaviour; exported components mount by name. No CDN scripts; `<Helmet>` holds CSS.

### Edit

[% include workflows.editing %]

### Create

[% include workflows.creation %]

Share its returned URL. [[ urlReplyRule ]]

## 3. Shape the content

- **Edit:** inherit the existing page type and design unless asked to change them. So you can choose which references among templates, design systems, copy, design, apps are relevant to read.
- **Create:** identify the reader and message; choose a page type ([templates](references/templates.md))
  and one design system ([design-systems](references/design-systems.md)). Read only the chosen guides BEFORE writing; they may be large.
- Use [copy](references/copy.md) for writing style guidance and [design](references/design.md) for composition guidance. Check numerical claims against query results: values, ratios and ranges. Charts encode every named series. Label assumptions separately from dataset facts.
- See [markup](references/markup.md) for the rich and powerful kit components we offer.

These are the common references. For but Artifactbin supports a long tail of rich features, whose guides can be read as necessary.
- For shared apps with friends or a team (signup, voting or RSVP), read [apps](references/apps.md) before choosing the data model; use accounts, not typed names, for identity.
- For data apps, dashboard/query mechanics, mutations: [data-markup](references/markup-data.md)


## 4. Save, share and verify
[% include workflows.operations %]
Check the changed content for a text edit. For a new page or layout change, check the whole document and phone layout. Use [live sessions](references/live-sessions.md) for browser/UI QA of newly authored or changed `<Mutation>`, local state and row/cell context actions. Test each identity’s authorized isolated copy, then the original as guest (writes off). One session at a time; reuse it and close it afterward. Stop once each works once per identity. Report which checks passed and anything unverified; do not repeat unchanged QA.

On refusal, follow [publishing](references/publishing.md) and [errors](references/errors.md). Conflicts preserve files; after an uncertain write repeat the same command and arguments, not a new artifact.

### Monitoring

[% include workflows.monitoring %]


## Some Important Notes
- [[ progressiveAuthoringRule ]]
- Always finish and fix at the same URL.
- Every body element keeps its persistent `id` for its lifetime. Move with the same id; never reuse an id. Only allowlisted tags; no `<form>`.
- Use `<Markdown>` for long prose on any page type: headings, paragraphs and lists together; HTML for individually designed text.
- Preserve exactly the identity fields returned; never add `version` when absent (an optional historical selection, not `head_version`). Fork: remove `id`, `edit_id`, `head_version`, `state`, `version`.
- [[ phoneAuthoringRule ]]
- One of the main goals of every artifact is to impress. Never finish with a meh looking artifact. Use visuals (images, mermaid, chart, wireframe, svg animations etc), color and playful design to your advantage.

## Example

Keep content away from viewport edges.

```jsx
[[ example ]]
```

## Reference tree

All paths are relative to the installed skill’s `SKILL.md`.
Branches group topics, not folders. Read only what the task needs.
Read a local reference or use HTTP: `<origin>/llms/<filename-without-.md>`.

- **Connect and operate**
[% if transport == "cli" %]
  - [npm-local.md](references/npm-local.md) — Internal compatibility setup
  - [publishing-auth.md](references/publishing-auth.md) — Internal compatibility authentication
  - [commands.md](references/commands.md) — Internal command reference
[% endif %]
  - [http-auth.md](references/http-auth.md) — HTTP sign-in, storage and refresh
  - [http-api.md](references/http-api.md) — HTTP operations and browser QA
  - [http-authoring.md](references/http-authoring.md) — Create and prepare source edits
  - [http-document-graph.md](references/http-document-graph.md) — Advanced graph updates
  - [publishing.md](references/publishing.md) — Sync, identity and conflict recovery
  - [publishing-annotations.md](references/publishing-annotations.md) — Read and reply to comments
  - [publishing-datasets.md](references/publishing-datasets.md) — Publish datasets and media
  - [publishing-query.md](references/publishing-query.md) — Query and inspect results
  - [publishing-versions.md](references/publishing-versions.md) — History, exports, forks and deletion
  - [operations.md](references/operations.md) — Operation contracts
  - [filters.md](references/filters.md) — List and comment filters
  - [errors.md](references/errors.md) — Specific errors and remedies
  - [groups.md](references/groups.md) — Ownership and membership
  - [live-sessions.md](references/live-sessions.md) — Browser sessions and interaction QA
  - [monitoring.md](references/monitoring.md) — Ongoing comment review
[% if transport == "cli" %]
  - [remote-review.md](references/remote-review.md) — Internal compatibility review
[% endif %]

- **Content and design**
  - [copy.md](references/copy.md) — Writing and factual accuracy
  - [design.md](references/design.md) — Composition and hierarchy
  - [worked-briefs.md](references/worked-briefs.md) — Examples of design decisions
  - [explainers.md](references/explainers.md) — Explain mechanisms visually
    - [explainer-shapes.md](references/explainer-shapes.md) — Complex isometric shapes and assemblies
  - [themes.md](references/themes.md) — Legacy theme compatibility
  - [templates.md](references/templates.md) — Choose a page type
    - [templates-doc.md](references/templates-doc.md) — Documents
    - [templates-deck.md](references/templates-deck.md) — Presentations
    - [templates-dashboard.md](references/templates-dashboard.md) — Dashboards
    - [templates-editorial.md](references/templates-editorial.md) — Articles
    - [templates-landing.md](references/templates-landing.md) — Landing pages
    - [templates-plan.md](references/templates-plan.md) — Plans
    - [templates-app.md](references/templates-app.md) — Applications
    - [templates-scrolly.md](references/templates-scrolly.md) — Scrollytelling
  - [design-systems.md](references/design-systems.md) — Choose one visual system
    - [system-almanac.md](references/system-almanac.md) — Almanac system
    - [system-arcade.md](references/system-arcade.md) — Arcade system
    - [system-broadsheet.md](references/system-broadsheet.md) — Broadsheet system
    - [system-dossier.md](references/system-dossier.md) — Dossier system
    - [system-drafting.md](references/system-drafting.md) — Drafting system
    - [system-meridian.md](references/system-meridian.md) — Meridian system
    - [system-nocturne.md](references/system-nocturne.md) — Nocturne system
    - [system-phosphor.md](references/system-phosphor.md) — Phosphor system
    - [system-redline.md](references/system-redline.md) — Redline system
    - [system-riso.md](references/system-riso.md) — Riso system
    - [system-signout.md](references/system-signout.md) — Signout system
    - [system-sorbet.md](references/system-sorbet.md) — Sorbet system
    - [system-volta.md](references/system-volta.md) — Volta system

- **Authoring and features**
  - [markup.md](references/markup.md) — JSX syntax and allowed elements
[% if transport == "cli" %]
  - [markdown.md](references/markdown.md) — Internal compatibility conversion
[% endif %]
  - [markup-compare.md](references/markup-compare.md) — Side-by-side comparison tables
  - [markup-components.md](references/markup-components.md) — Layout and UI components
  - [markup-editing.md](references/markup-editing.md) — Source edits and persistent IDs
  - [markup-data.md](references/markup-data.md) — Datasets, queries and mutations
  - [markup-data-example.md](references/markup-data-example.md) — Worked data-binding example
  - [markup-data-authoring.md](references/markup-data-authoring.md) — Chart encodings
  - [markup-sql.md](references/markup-sql.md) — SQL dialect
  - [markup-sql-functions.md](references/markup-sql-functions.md) — Supported SQL functions
  - [markup-state.md](references/markup-state.md) — Reader-local state
  - [markup-select.md](references/markup-select.md) — Multi-select filters
  - [markup-repeat.md](references/markup-repeat.md) — Repeated query-driven content
  - [markup-actions.md](references/markup-actions.md) — Row actions
  - [markup-scripts.md](references/markup-scripts.md) — Client behaviour with Solid/npm
  - [markup-embeds.md](references/markup-embeds.md) — Images, files and artifacts
  - [markup-upload.md](references/markup-upload.md) — Dataset file attachments
  - [markup-maps.md](references/markup-maps.md) — Geographic maps
  - [markup-motion.md](references/markup-motion.md) — Animation
  - [markup-svg.md](references/markup-svg.md) — Vector illustrations
  - [markup-notifications.md](references/markup-notifications.md) — Mutation-triggered notifications
  - [apps.md](references/apps.md) — Shared apps and access rules
  - [databases.md](references/databases.md) — Dataset catalogs and notebooks
  - [databases-users.md](references/databases-users.md) — Account fields and membership
  - [dataset-images.md](references/dataset-images.md) — Legacy image uploads
  - [lambdas.md](references/lambdas.md) — Server-side handlers
  - [review-state.md](references/review-state.md) — Wireframes and saved views
