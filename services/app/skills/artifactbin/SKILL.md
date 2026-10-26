---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing page or app. Use the author skill and authenticated HTTP API contracts.
---
[% if transport == "http" %]
## Read first

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries. Load the core once with `<script src="/af/v1/core.js" data-af="core"></script>`; it provides the `@afbin/apollo` import. No JSX, framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; [authentication](references/http-auth.md) explains email sign-in and refresh. Missing credentials do not mean a new account. If sign-in is required, reuse an email already provided; otherwise ask for it, request the emailed code and wait. Never invent an identity.

For an existing page, read its canonical `html`, `version` and `state`, preserve `data-af-id` identities, edit the HTML and publish to the same ID. For new work, choose the content and one design system, build a complete useful first version, publish and share its returned URL before extending it. A URL-only request gets the URL alone.

Direct HTTP: create with `POST /api/artifacts`; replace with `PUT /api/artifacts/ID`, observed `expectedVersion` and `expectedState`, and a durable `Idempotency-Key`. On 409, read the new head and reconcile; never attach it to stale source.

## Author and publish

[[ authorCommands ]]

Every script supports complete offline `--help`, `--server ORIGIN`, `--json` and exclusive `--output FILE` where applicable. Use the archive’s Node scripts, never shell-built HTTP wrappers; read `--help`, not script source; [authentication](references/http-auth.md) reuses the same private origin-bound grant. Groups, ACLs, secrets and trash remain explicit HTTP operations.

1. Read [native HTML publication](references/html-authoring.md). New source: `node scripts/publish.mjs ./project/index.html`; local CSS, images, fonts and backend files publish together. Existing source: `node scripts/read.mjs ID --output page.html`, edit its canonical IDs, then `node scripts/publish.mjs page.html`. Publish rewrites that file and its `.af.json` companion in place with the canonical result, so keep editing and publishing the same file; never copy or hand-edit companions. Its external immutable journal supports `--resume FILE` after an uncertain write; no new key or identity. A bare `POST /api/artifacts` refuses unresolved local dependencies.
2. Read [state and JavaScript](references/html-runtime.md), including explicit field declarations for saved comment views. All page state goes through `client` from `@afbin/apollo`. Top-level local state is private to each viewer’s browser. Shared data lives behind declared dataset/backend namespaces. Never put a bearer, refresh token or session cookie in HTML, state, scripts, examples or downloaded files.
3. Pick one [design system](references/html-design-systems.md). The installed `design-systems/NAME.css` is generated from the retained specifications. Keep `design-systems/` and the packaged `fonts/` inside the project root; link `./design-systems/NAME.css` from root-level HTML (adjust for subfolders). Preserve its fonts, colors and type roles, then compose the page for the actual subject. Use `class`, ordinary forms and CSS; optional native components below need explicit registration.
4. For a CSV/dashboard read [datasets](references/html-datasets.md). For a shared app read [backend files](references/html-backends.md) before modeling identity or writes. A readable page grants no dataset write access. Use authenticated account identity, never a name typed into a form, to authorize actions.
5. Run `node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs --output qa.json`; [operations](references/html-operations.md) explains task hooks and the 20-second/16-execution session limits. Check values against data and exercise requested behavior, persistence and permission refusals. For slides add `--viewport 1200x630`; its summary lists text each `data-af-slide` clips at that viewport. Inspect screenshots with image-capable review; text/geometry alone leaves appearance unverified. Without image input, report appearance as unverified; don't decode pixels or OCR. Stop once requested behavior and appearance pass at desktop and 390px; fix remaining defects, then stop optional polish. Report observed tests, assumptions and unverified acceptance.

For HTML comment anchors and server-side browser verification, read [HTML operations](references/html-operations.md). It describes the native HTML anchor contract and how to inspect the sandboxed document frame.

## Optional HTML components

Copy the installed `components/` module graph into the project and import its compiled `.js` registrations. Read [usage and contracts](references/html-components.md); `.ts` is readable source, not a browser script. The 24 UI elements below require explicit registration. The legacy `af-mermaid` and `af-deck-gl` wrappers remain available for compatibility; new diagrams and maps use the direct libraries.

| Purpose | Retained elements |
|---|---|
| [Controls](references/html-components.md#controls-and-composition) | `af-button`, `af-input`, `af-textarea`, `af-slider`, `af-switch`, `af-select`, `af-segmented`, `af-date-picker` |
| [Navigation/disclosure](references/html-components.md#controls-and-composition) | `af-tabs`, `af-accordion`, `af-collapsible` |
| [Overlays](references/html-components.md#controls-and-composition) | `af-dialog`, `af-popover`, `af-tooltip` |
| [Identity/status](references/html-components.md#content-and-data) | `af-avatar`, `af-user`, `af-icon`, `af-progress` |
| [Prose/diagrams](references/html-components.md#content-and-data) | `af-markdown`, `af-isometric` |
| [Data/media](references/html-components.md#content-and-data) | `af-data-table`, `af-file-upload` |
| [Slides](references/html-components.md#content-and-data) | `af-slide-deck`, `af-slide` |

For native HTML visualizations, use the direct library APIs rather than a custom chart or map element. Choose the guide that fits the work:

| Need | Guide |
|---|---|
| Analytical charts or custom chart layouts | [Vega and Vega-Lite](references/dataviz.md) |
| Interactive maps and geospatial layers | [deck.gl](references/maps.md) |
| Flowcharts, sequences and other diagrams | [Mermaid](references/diagrams.md) |

The guides give the exact shipped ESM imports, theming, resizing, cleanup and offline limits. Existing `af-mermaid` and `af-deck-gl` elements remain documented for pages that already use those compatibility components. Components use page tokens and author-owned Apollo state; the app supplies data and authorized transport. Verify the actual browser behavior required by the page.

## Preserve the document

Every saved page version remains available. Keep stable `data-af-id` attributes when moving or editing elements. Never reuse an ID removed in an earlier version. Newly authored elements may omit IDs and receive server-assigned identities; save the canonical returned HTML before the next edit. For elements created by scripts, derive stable `data-af-id` values from record IDs and keep them beneath a container present in saved source; the platform scopes comments automatically. Read [dynamic element identities](references/html-runtime.md#dynamic-elements-and-comments). HTML `id` remains available for ordinary browser anchors and selectors.

Use `data-af="meta"`, `data-af="state"`, `data-af="core"` and `data-af="design-system"` for platform blocks. Color mode/design selection belongs on `<html data-af-dark="false" data-af-design-system="NAME">`. Page scripts execute on the page’s runner origin, separately from account credentials.

## Installed resources

[Download the author skill]([[ base ]]/skills/artifactbin.zip) and extract its one `artifactbin/` folder into your harness’s skill directory, then reload skills. The archive is one `artifactbin/` skill folder. Read only the guide needed for the task:

- [Authentication](references/http-auth.md): verified email, private credential storage and serialized refresh.
- [HTML publication](references/html-authoring.md): create, conditional replacement, identity and retry recovery.
- [Runtime](references/html-runtime.md): Apollo local state, remote namespaces and offline behavior.
- [HTML components](references/html-components.md): registrations, properties, events and app-owned adapters.
- [HTML comments and browser verification](references/html-operations.md): native anchors, server browser sessions and runner-frame inspection.
- [Data visualization](references/dataviz.md): chart choices, truthful encodings, themes and Vega/Vega-Lite guidance.
- [Diagrams](references/diagrams.md): direct Mermaid rendering, themes, lifecycle and offline behavior.
- [Maps](references/maps.md): direct deck.gl layers, view state, resize, cleanup and basemap/data limits.
- [Local HTML files](references/local-files.md): private preview, linked copies, actual source comparison and deliberate save/publication.
- [Installable pages and slides](references/html-authoring.md#installable-page-presentation): static head metadata and explicit capture boundaries.
- [Offline images](references/html-runtime.md#portable-images) and [reader presence](references/html-sharing.md#reader-presence): download limits and platform-owned preferences.
- [Datasets](references/html-datasets.md): CSV import, schema discovery and stable dataset IDs.
- [Backend files](references/html-backends.md): TypeScript resolvers, shared stores and permissions.
- [Design systems](references/html-design-systems.md): select one, then read its generated native guide.
- [Examples and verification](references/html-examples.md): report, CSV dashboard and shared task app.

For a private draft, run `node scripts/serve.mjs PROJECT_DIR` and `node scripts/check.mjs http://127.0.0.1:PORT/`; [local preview](references/html-preview.md) covers offline limits and isolated browser requirements. The installed archive includes local runtime assets.

Scripts are helpers inside this skill, not installed global product commands. Existing `preview.mjs` and `publication-bundle.mjs` entrypoints are compatibility shims; use the verb commands above.
[% else %]

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
  - [html-operations.md](references/html-operations.md) — Native HTML comments and runner-frame browser QA
  - [http-authoring.md](references/http-authoring.md) — Create and prepare source edits
  - [http-document-graph.md](references/http-document-graph.md) — Advanced graph updates
  - [local-files.md](references/local-files.md) — Local preview, source comparison and deliberate saving
  - [publication-bundles.md](references/publication-bundles.md) — Native HTML project dependencies
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
  - [dataviz.md](references/dataviz.md) — Native chart authoring
  - [maps.md](references/maps.md) — Native deck.gl map authoring
  - [diagrams.md](references/diagrams.md) — Native Mermaid diagram authoring
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
[% endif %]
