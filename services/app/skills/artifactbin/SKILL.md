---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing page or app. Use the author skill and authenticated HTTP API contracts.
---
[% if transport == "http" %]
## Read first

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries. Import `@afbin/apollo` and every hosted library as `@afbin/<name>` (`vega`, `vega-lite`, `pele-*`, `deck-gl`, `three`, `highlight`); that prefix is reserved. `@afbin/highlight` exports `highlightAll(root)` for `pre > code.language-*`. No JSX, framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; `node scripts/auth.mjs` signs in and refreshes (read the top of it). Missing credentials do not mean a new account. If sign-in is required, reuse an email already provided; otherwise ask for it, request the emailed code and wait. Never invent an identity.

Direct HTTP, only if a script cannot: create with `POST /api/artifacts`; replace with `PUT /api/artifacts/ID`, observed `expectedVersion` and `expectedState`, and a durable `Idempotency-Key`. On 409, read the new head and reconcile; never attach it to stale source.

## You write / the platform adds

- **You write:** a normal HTML file; one `<meta name="artifactbin:design-system" content="NAME">`; imports from `@afbin/<name>` (`apollo`, `highlight`, the libraries); your own CSS and JS; a `data-af-id` only to keep ones you were given.
- **The platform adds:** the core runtime and import map, the design-system stylesheet and fonts, the `<html>` design and dark-mode attributes, stable `data-af-id`s (carried forward on edits), autofix of common mistakes (reported as `autofix:`), code-highlighting colours, reader presence and comments, and the owner's design-system picker. A core tag, `<html data-af-*>` attributes or a copied stylesheet link you write anyway still works: publish moves or removes them.

## Core flows

Every script takes `--help`, `--server ORIGIN`, `--json` and an exclusive `--output FILE`. To learn one, read the top of it (`head -30 scripts/NAME.mjs`: purpose, usage, flags, examples, gotchas; `--help` prints the same text). Use these scripts, never shell-built HTTP wrappers. Reuse the saved sign-in (`node scripts/auth.mjs status`; its top covers login and refresh). Groups, ACLs, secrets and trash have no script.

- **New page.** Plan in at most ~5 lines with no CSS, JS or copy in your reasoning; never draft the page there first. Start from the closest example (`cp examples/csv-dashboard.html index.html` for a dashboard, `examples/shared-app.html` for a shared app or backend, Decks below for slides) and write `index.html` as your next action, a compact first version (about 30 KB). Pick one design system from the table and name it in `<head>` with `<meta name="artifactbin:design-system" content="NAME">`; the platform serves the stylesheet, sets the `<html>` attributes and hosts the fonts, so copy and link nothing. `design-systems/NAME.css` has its exact tokens, type-role classes (`t-title`, …) and what each colour is for. Keep state through `client` from `@afbin/apollo` ([runtime](references/runtime.md)). Optionally preview with `node scripts/serve.mjs ./project`, then `node scripts/publish.mjs index.html`; it autofixes the page and prints an `autofix:` report to read (`node scripts/autofix.mjs FILE` only for a file you aren't publishing). Publish as soon as the first version renders and share the returned URL before extending it; a URL-only request gets the URL alone.
  | Name | Mood | Fits |
  |---|---|---|
  | `volta` | Loud | Data products, dashboards, launch pages |
  | `phosphor` | Technical | Dev tools, CI, logs, status pages |
  | `drafting` | Technical | Plans, specs, explainers, process stories |
  | `meridian` | Sleek, Professional | Product dashboards, docs, SaaS marketing |
  | `dossier` | Evidential | Plans, reports, post-mortems, long features |
  | `riso` | Printed | Scrolly stories, picture-book explainers, posters, zines |
  | `almanac` | Warm | Scrolly explainers, landing pages, long reads, annual reports |
  | `redline` | Poster | Slides, decision briefs, launch pages, posters |
  | `nocturne` | Atmospheric | Long reads, features, evening and culture subjects |
  | `broadsheet` | Editorial | Features, reports, newsletters, long reads |
  | `signout` | Utilitarian | Booking apps, intake forms, rosters, inventories |
  | `sorbet` | Fun | Consumer apps, launches, kids and food, celebrations, playful data |
  | `arcade` | Fun | Games, launches, leaderboards, playful dashboards, teaching |
  - Design: start from the reader's decision and the subject's own visual material; give the opening a concrete point, one expressive moment, and let typography set the hierarchy (no identical cards for every paragraph). Use real data in charts, label assumptions, keep lines under about 80 characters and controls keyboard-usable.
  - Decks: stack full-viewport `<section data-af-slide>` elements (each simple: a heading, a few lines, at most one chart or diagram), mark the nav `data-af-deck-chrome`, and move with `scrollIntoView({behavior:'auto'})` (smooth scrolling makes steps read mid-scroll). Slides are designed for 1200x630: check decks with `--viewport 1200x630 --viewport 1280x800` only, and reply with `slide=N` links (`export.mjs --slide N`) instead of testing exports.
  - Never put a bearer, refresh token or session cookie in HTML, state, scripts, examples or downloaded files. Use authenticated account identity, never a name typed into a form, to authorize actions.
- **Check.** `node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs --output qa-1.json` (a new `--output` name each run; decks as above). Write one short steps file that waits for your data and checks the requested values and behaviour; set values explicitly and `waitForFunction` the expected text after each click. Fix only what fails, rerun once. The summary is your layout evidence (no own pixel scripts or re-exports): after one passing steps run that covers the requested behaviour, with no errors, overflow, contrast, clipping, overlap or duplicate ids, reply with the link and what you tested, then stop. Republish only to fix a failed requirement, never for polish, refactors or extra verification. Don't open screenshots unless your model accepts image input; otherwise say appearance is unverified.
- **Edit a page.** `node scripts/read.mjs ID --output page.html`, edit that file, then `node scripts/publish.mjs page.html`; keep editing and publishing the same file and never regenerate the page from scratch. Keep every existing `data-af-id`; new static elements may omit it. Elements your script creates (list rows, cards, table rows, labels) each need a `data-af-id` that is unique on the page and identical on every render, built as `<list>-<record id>-<role>`: `item.dataset.afId='budget-row-'+tx.id; amount.dataset.afId='budget-row-'+tx.id+'-amount'`. Use a distinct prefix per list and role; never an array index, display text, sort order or random value; never reuse a saved or deleted ID; mount them under a container present in the saved HTML ([dynamic elements](references/runtime.md#dynamic-elements-and-comments)).
- **Answer comments.** `node scripts/comment.mjs list ID`. If a comment asks for a change, make the edit first, then `node scripts/comment.mjs reply ID --thread T --body-file reply.txt` (add `--resolve --expected-revision R` when done). Anchors are described at the top of `comment.mjs`.[% if not shipped %] Direct-HTTP agents: [authentication](references/http-auth.md) and [comment anchors and browser sessions](references/html-operations.md).[% endif %]
- **Monitor.** `node scripts/comment.mjs watch ID` streams new comments.
- **Data, apps, exports.** CSV and datasets: [datasets](references/datasets.md). Shared apps and backend files: [backends](references/backends.md) (read before modeling identity or writes; a readable page grants no dataset write access). `node scripts/graphql.mjs schema ID` for the linked schema, `node scripts/export.mjs ID --format html --output copy.html` for a portable copy.
- **Network and install.** To call an external API add `<meta name="csp-connect" content="https://api.example.com">` in `<head>` (also `csp-script`, `csp-style`, `csp-img`, `csp-frame`, `csp-media`); readers are asked to allow new origins and publish rejects invalid declarations. For an installable page use the `artifactbin:pwa-enabled`, `-name`, `-short-name`, `-theme-color`, `-background-color` and `-icon` metas in `<head>`; autofix explains invalid values.

## Optional HTML components

Copy the installed `components/` directory into the project (all of it: helpers and engine chunks come along) and import the compiled `.js` registrations, e.g. `import {registerInput} from './components/input.js'; registerInput();`; repeat calls are safe. To learn an element, read the comment at the top of its `.ts` (`head -30 components/NAME.ts`: import line, attributes, events, usage); the `.ts` is readable source, not a browser script. Most controls emit a bubbling `af-change` with `event.detail.value`: keep the value in Apollo state, set it back on the element (switch `checked`, overlays and collapsible `open`, slide deck `index`, the rest `value`) and unsubscribe when the view goes away. Elements use light DOM and the page's design-system tokens, carry no credentials, and need explicit registration. The legacy `af-mermaid` and `af-deck-gl` wrappers remain for compatibility; new diagrams and maps use the direct libraries below.

| Purpose | Elements (see `components/NAME.ts`) |
|---|---|
| Controls | `af-button`, `af-input`, `af-textarea`, `af-slider`, `af-switch`, `af-select`, `af-segmented`, `af-date-picker` |
| Navigation/disclosure | `af-tabs`, `af-accordion`, `af-collapsible` |
| Overlays | `af-dialog`, `af-popover`, `af-tooltip` |
| Identity/status | `af-avatar`, `af-user`, `af-icon`, `af-progress` |
| Prose/diagrams | `af-markdown`, `af-isometric` |
| Data/media | `af-data-table`, `af-file-upload` |
| Slides | `af-slide-deck` (with `af-slide`) |

For native HTML visualizations, use the direct library APIs rather than a custom chart or map element. Choose the guide that fits the work:

| Need | Guide |
|---|---|
| Analytical charts or custom chart layouts | [Vega and Vega-Lite](references/dataviz.md) |
| Interactive maps and geospatial layers | [deck.gl](references/maps.md) |
| Flowcharts, sequences and other diagrams | [Pele](references/diagrams.md) |

The guides give the exact imports, theming, resizing, cleanup and offline limits.

## Sharing and access

A link never carries your login: whoever opens it signs in as themselves. Visibility only controls who can read; editing, comments and dataset writes are separate permissions.

- "Make it public": `node scripts/publish.mjs page.html --visibility public` (the default is unlisted).
- "Share it with my team": `node scripts/publish.mjs page.html --group HANDLE`. Group editors can edit, viewers can read.
- "Let readers submit something": a readable page grants no writes; use a backend mutation with a role directive ([backend permissions](references/backends.md)).
- Cursors and reader presence are the platform's; don't build them.

## Preserve the document

Every saved page version remains available; never reuse an ID removed in an earlier version, and save the canonical returned HTML before the next edit. A 409 or a refused baseline means someone else edited: read again and reapply. HTML `id` remains available for ordinary browser anchors and selectors. Initial viewer state goes in `<script type="application/json" data-af="state">`. Page scripts execute on the page's runner origin, separately from account credentials.

## Installed resources

[Download the author skill]([[ base ]]/skills/artifactbin.zip) and extract its one `artifactbin/` folder into your harness’s skill directory, then reload skills. Read only the guide needed for the task:

- [Runtime](references/runtime.md): Apollo local state, remote namespaces and offline behavior.
- [Data visualization](references/dataviz.md): chart choices, truthful encodings, themes and Vega/Vega-Lite guidance.
- [Diagrams](references/diagrams.md): Pele rendering of Mermaid syntax, themes, lifecycle and offline behavior.
- [Maps](references/maps.md): direct deck.gl layers, view state, resize, cleanup and basemap/data limits.
- [Offline images](references/runtime.md#portable-images): download limits.
- [Datasets](references/datasets.md): CSV import, schema discovery and stable dataset IDs.
- [Backend files](references/backends.md): TypeScript resolvers, shared stores and permissions.
- `examples/`: each file's top comment says what it shows and which files go with it.

Only when the user asks for a private draft, run `node scripts/serve.mjs PROJECT_DIR` and `node scripts/check.mjs http://127.0.0.1:PORT/` (local checks need Playwright via `--playwright-module`, and the preview adds a 76px toolbar, so measure published pages by ID); the top of `scripts/serve.mjs` covers offline limits and isolated browser requirements. The installed archive includes local runtime assets.

Scripts are helpers inside this skill, not global commands; `preview.mjs` and `publication-bundle.mjs` are compatibility shims.
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
  - [diagrams.md](references/diagrams.md) — Native Pele diagram authoring
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
