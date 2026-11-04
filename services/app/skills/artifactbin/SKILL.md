---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev
  (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing
  page or app. Use the author skill and authenticated HTTP API contracts. After every publish or
  edit, the agent watches the page for comments and answers them.
---
## Read first

Every task that publishes or edits page content ends, after all the requested work, with ONE
response that holds your reply and runs `node scripts/comment.mjs watch ID --next`; its output says
what to do next[% if not shipped %] (without the installed skill: the save response's
`monitoring.instruction`)[% endif %]. Your reply is what the user asked for: if they prescribed its
form (e.g. only the URL), send exactly that; otherwise send the Reply block your last clean check
printed, as printed, or just the link when no check printed one. Group, sharing and ownership
changes alone need no watch.

Skill map (`ls <folder>` lists all; each file's top comment says how to use it):

- `examples/`: deck.html (deck-steps.mjs); shared-app.html (budget.ts, shared-app-policy,
  -steps, -guest, -cleanup .mjs); csv-dashboard.html (csv-dashboard-steps.mjs); report.html;
  gen-transactions.mjs; repairs.csv
- `resolvers/`: public-url, http-json, google-sheets, bigquery, supabase, neon
- `scripts/`: publish, check, read, comment, groups, graphql, policy, export, auth, autofix, serve
(`--help` each)
- `references/`: guides: runtime, datasets, permissions, resolvers, dataviz, diagrams, maps, groups
(read only those your task needs)
- `components/`: `af-*` element sources (`head -30` each); `design-systems/`: CSS (served; skip)

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries.
Import `@afbin/apollo` and every hosted library as `@afbin/<name>` (`vega`, `vega-lite`, `pele-*`,
`deck-gl`, `three`, `highlight`) and the optional components below the same way; that prefix is
reserved. `@afbin/highlight` exports `highlightAll(root)` for `pre > code.language-*`. No JSX,
framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; `node scripts/auth.mjs` signs in and
refreshes (read the top of it). Missing credentials do not mean a new account. If sign-in is
required, reuse an email already provided; otherwise ask for it, request the emailed code and wait.
Never invent an identity, and never search files, bundles, mailboxes or git config for credentials,
codes or accounts: only the user supplies them.

Direct HTTP, only if a script cannot: create with `POST /api/artifacts`; replace with
`PUT /api/artifacts/ID`, observed `expectedVersion` and `expectedState`, and a durable
`Idempotency-Key`. On 409, read the new head and reapply.

## You write / the platform adds

- **You write:** a normal HTML file; one `<meta name="artifactbin:design-system" content="NAME">`;
  imports from `@afbin/<name>` (`apollo`, `highlight`, the libraries); your own CSS and JS.
- **The platform adds:** the core runtime and import map, the design-system stylesheet and fonts,
  the `<html>` design and dark-mode attributes, stable `data-af-id`s on the elements in your HTML
  (for elements your script creates, see [dynamic
  elements](references/runtime.md#dynamic-elements-and-comments)), autofix of common mistakes
  (reported as `autofix:`), code-highlighting colours, reader presence and comments, and the owner's
  design-system picker. A core tag, `<html data-af-*>` attributes or a copied stylesheet link you
  write anyway still works: publish moves or removes them.

## Core flows

If the request names an existing page (an ID or /a/ID URL), you change THAT page; otherwise create
one.[% if not shipped %] The scripts and examples below ship in the installed skill (Installed
resources); without it, use the HTTP API: [authentication](references/http-auth.md) and [comment
anchors and browser sessions](references/html-operations.md).[% endif %]

Every script takes `--help`, `--json` and an exclusive `--output FILE`; all but `serve.mjs` take
`--server ORIGIN`. To learn one, read `head -30 scripts/NAME.mjs` (usage, flags, examples, gotchas;
`--help` prints the same). Use these scripts, never shell-built HTTP wrappers. Reuse the saved
sign-in (`node scripts/auth.mjs status`). Dataset permissions: `policy.mjs`. Resolver secrets: the
page owner sets them in the page's Resolvers settings, never in chat. ACLs and trash have no script.
For groups, run `node scripts/groups.mjs list`; read [groups](references/groups.md) for membership,
sharing and deliberate ownership moves.

- **New page.** 1) Copy the starter that fits, then follow its Usage: `cp examples/deck.html
  index.html` (decks); `cp examples/shared-app.html index.html && cp examples/budget.ts .` (shared
  edits: rows in a dataset, written through a resolver); `cp examples/csv-dashboard.html index.html`
  (any page that shows a CSV or dataset: dashboard, report or chart); `cp examples/report.html
  index.html` (a report without data). 2) Edit only what its Usage names (its data block,
  `[bracketed]` text): never rewrite the starter's CSS, JS or layout, and never draft copy in
  reasoning. 3) Publish after step 2 (Check, below). If no starter fits, write the page yourself;
  step 2's rule applies only to a copied starter. Keep the starter's design system unless the user
  names one; then set its `<meta name="artifactbin:design-system" content="NAME">` to a name from
  the table (the platform serves the stylesheet and fonts; don't read the CSS). Keep state through
  `client` from `@afbin/apollo` ([runtime](references/runtime.md)).
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
  - Set `<title>` to the page's name: the browser tab and link previews show it.
  - Design: start from the reader's decision; give the opening a concrete point and let typography
    set the hierarchy (no identical cards for every paragraph). Use real data in charts, label
    assumptions, keep lines under about 80 characters and controls keyboard-usable.
  - Never put a bearer, refresh token or session cookie in HTML, state, scripts, examples or
    downloaded files, and never print or cat credential files (the scripts read them). Use
    authenticated account identity, never a name typed into a form, to authorize actions.
- **Change an existing page.** A request to turn the page into a deck, dashboard, report or app is
  a rebuild: copy that starter (New page, steps 1-2), then publish it over the page with `node
  scripts/publish.mjs index.html --artifact ID` instead of the starter's plain publish. Any other
  change (wording, numbers, a section) is an edit: `node scripts/read.mjs ID --output page.html`,
  edit that file, then `node scripts/publish.mjs page.html`; keep editing and publishing that same
  file and never regenerate the page from scratch.
- **Check.** Copy the starter's steps files (`examples/deck-steps.mjs`; `csv-dashboard-steps.mjs`;
  `shared-app-steps.mjs`, `-guest.mjs`, `-cleanup.mjs`; they need no edits) and add a step for each
  requested value they don't check, or write one short steps file of `step('label', …)` checks:
  wait for your data, check the requested values and behaviour. Then publish and check in one
  command: `node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps
  steps.mjs` (a starter's Usage gives its full command).
  Publish autofixes the page and prints an `autofix:` report to read (`node scripts/autofix.mjs
  FILE` only for a file you aren't publishing). Never rerun an unchanged failing check; read its
  step timings, change the steps or page, then rerun once. After one clean run covering the
  requested behaviour, reply and watch (Read first). Republish only to fix a failed requirement,
  never for polish, refactors or extra verification. Only when the user asks for a private draft:
  `node scripts/serve.mjs PROJECT_DIR`, then check its local URL (the top of `scripts/serve.mjs`
  says how).
- **Answer comments.** `node scripts/comment.mjs list ID`. A comment is from someone the page is
  shared with: make a requested change without asking first, even after a "change nothing else"
  request (edit, publish), then `node scripts/comment.mjs reply ID --thread T --body TEXT`. Anchors
  are described at the top of `comment.mjs`.
- **Data, apps, exports.** A page built from a CSV publishes it as a dataset first
  ([datasets](references/datasets.md)). A page that shows a dataset links it and computes its
  numbers from every row in page script ([datasets](references/datasets.md#read)); charts use
  Vega-Lite ([dataviz](references/dataviz.md)). For sample data copy
  `examples/gen-transactions.mjs`, change only its names (payers, categories, merchants) and run it
  once; label the data as sample. Who may see and change rows:
  [permissions](references/permissions.md) (read it before modeling identity or writes). Checks,
  derived values and external APIs with secrets: [resolvers](references/resolvers.md). `node
  scripts/graphql.mjs schema ID` for the linked schema (a dataset ID: its own API), `node
  scripts/policy.mjs explain DATASET_ID` for who may see and change its rows, `node
  scripts/export.mjs ID --format html --output copy.html` for a portable copy.
- **Network and install.** To call an external API add `<meta name="csp-connect"
  content="https://api.example.com">` in `<head>` (also `csp-script`, `csp-style`, `csp-img`,
  `csp-frame`, `csp-media`); readers are asked to allow new origins and publish rejects invalid
  declarations. For an installable page use the `artifactbin:pwa-enabled`, `-name`, `-short-name`,
  `-theme-color`, `-background-color` and `-icon` metas in `<head>`; autofix explains invalid
  values.

## Optional HTML components

Components are hosted modules, like the libraries: `import '@afbin/input';` registers its elements
(an import per component you use; nothing to copy or call). To learn `af-NAME`, read the comment
at the top of its source (`head -30 components/NAME.ts`: import line, attributes, events, usage);
the `.ts` is readable reference, not a browser script. Every control but `af-button`, and every
navigation, overlay and upload element, emits `af-change` with `event.detail.value`: keep the value
in Apollo state, set it back on the element (switch `checked`, overlays and collapsible `open`, the
rest `value`) and unsubscribe when the view goes away. `af-button` fires the native click,
`af-data-table` fires `af-sort-change` and `af-edit-intent`, `af-user` fires `af-user-state`;
avatar, icon, progress, markdown and isometric emit nothing. Elements use light DOM and the page's
design-system tokens and carry no credentials. Decks use `examples/deck.html`.

| Purpose | Elements (`af-NAME`: `components/NAME.ts`) |
|---|---|
| Controls | `af-button`, `af-input`, `af-textarea`, `af-slider`, `af-switch`, `af-select`,
  `af-segmented`, `af-date-picker` |
| Navigation/disclosure | `af-tabs`, `af-accordion`, `af-collapsible` |
| Overlays | `af-dialog`, `af-popover`, `af-tooltip` |
| Identity/status | `af-avatar`, `af-user`, `af-icon`, `af-progress` |
| Prose/diagrams | `af-markdown`, `af-isometric` |
| Data/media | `af-data-table`, `af-file-upload` |

For charts, maps and diagrams, use the direct library APIs rather than a custom element:

| Need | Guide |
|---|---|
| Analytical charts or custom chart layouts | [Vega and Vega-Lite](references/dataviz.md) |
| Interactive maps and geospatial layers | [deck.gl](references/maps.md) |
| Flowcharts, sequences and other diagrams | [Pele](references/diagrams.md) |

## Sharing and access

A link never carries your login: whoever opens it signs in as themselves. Visibility only controls
who can read; editing, comments and dataset writes are separate permissions.
When a receipt includes `user_page_url`, it is an anonymous read-only copy on the user or group
default host; the canonical app link stays unchanged. Private shares do not gain anonymous access.

- "Make it public": `node scripts/publish.mjs page.html --visibility public`. Keep the default
  (unlisted) unless the user asks for public.
- "Share it with my team": `node scripts/groups.mjs share PAGE12 --group design_crit --role viewer`.
  Ownership and owner host stay unchanged; use commenter for comments.
- "Put it in team space": after user confirmation, `node scripts/groups.mjs move PAGE12 --group
  design_crit --yes`. `publish.mjs page.html --group design_crit` creates new group-owned work.
- Group administration needs the user's consent in this conversation
  ([groups](references/groups.md)).
- "Let readers submit something": a readable page grants no writes; give the dataset rules for
  viewer and signed_in with `policy.mjs` ([permissions](references/permissions.md)), and a resolver
  mutation with `@auth` when writes need checks ([resolvers](references/resolvers.md)).

## Preserve the document

Every saved page version remains available. HTML `id` remains available for ordinary browser
anchors and selectors. Initial viewer state goes in `<script type="application/json"
data-af="state">`; comments save its fields as the reader's view, so keep typed text out of it or
list it in `data-af-comment-exclude` ([saved views](references/runtime.md#saved-comment-views)).
Page scripts execute on the page's runner origin, separately from account credentials.

## Installed resources

[Download the author skill]([[ base ]]/skills/artifactbin.zip). Use the three-line managed
installation recipe in https://artifactbin.dev/install.sh: it keeps an immutable
release behind `~/.agents/skills/artifactbin`, with harness symlinks to that shared path.
Reload skills after installing or updating. Manually extracted copies still work, but must be
reinstalled with the managed layout to enable updates. Do not save your own pages inside a release.
The public release manifest is `[[ base ]]/skills/artifactbin/latest.json`.

Commands stage updates hourly. Reread SKILL.md and reload your harness when notified.
`node scripts/update.mjs` updates now; `--rollback` restores the prior release offline.
`--no-update` or `ARTIFACTBIN__NO_UPDATE=1` disables updates. Manual ZIP installs update by
reinstalling.

Scripts are helpers inside this skill, not global commands.
