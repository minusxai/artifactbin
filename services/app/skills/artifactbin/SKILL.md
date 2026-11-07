---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev
  (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing
  page or app. Use the author skill and authenticated HTTP API contracts. After every publish or
  edit, the agent watches the page for comments and answers them.
---
## Read first

[% if shipped %]After you publish or edit a page (answering a comment too), reply to the user and
run `node scripts/comment.mjs watch ID --next` as its printed Next line says (even
when the reply is only the link); then do what comments ask.[% else %]After you publish
or edit a page (answering a comment too), reply to the user and start the save response's
`monitoring.instruction` (with the installed skill: `node scripts/comment.mjs watch ID --next`,
as its printed Next line says), then do what comments ask.[% endif %] The reply is the link plus
what the user asked for, in the form they asked for; a form they prescribe limits the reply's text,
never the watch.
Describe testing, build and permissions only from what `check` reported.

Skill map (each file's top comment explains it):

- `examples/`: deck.html (deck-steps.mjs); shared-app.html (budget.ts, shared-app-policy,
  -steps, -guest, -cleanup .mjs); shared-list.html and api-dashboard.html (api-dashboard.ts),
  each with -steps, -guest, -cleanup .mjs; csv-dashboard.html (csv-dashboard-steps.mjs);
  report.html; gen-transactions.mjs; repairs.csv
- `resolvers/`: public-url, http-json, google-sheets, bigquery, supabase, neon
- `scripts/`: publish, check, read, comment, doc, groups, graphql, policy, export, auth, autofix,
serve, new-app, new-page
- `references/`: guides (read only those you need): runtime, datasets, permissions, resolvers,
dataviz, diagrams, maps, groups
- `components/`: `af-*` element sources (`head -30` each); `design-systems/`: CSS the platform
  serves (only its header, the shared tokens, is worth reading)

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries.
Import `@afbin/apollo` and every hosted library as `@afbin/<name>` (`vega`, `vega-lite`, `pele-*`,
`deck-gl`, `three`, `highlight`) and the optional components below the same way; that prefix is
reserved. `@afbin/highlight` exports `highlightAll(root)` for `pre > code.language-*`. No JSX,
framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; `node scripts/auth.mjs` signs in and
refreshes (`--help`). Missing credentials do not mean a new account. If sign-in is
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

Every script takes `--help` (usage, flags, examples, gotchas), `--json` and an exclusive `--output
FILE`; all but `serve.mjs` take `--server ORIGIN`. Use these scripts, never shell-built HTTP
wrappers; they reuse the saved sign-in (`node scripts/auth.mjs status` shows it). Dataset
permissions: `policy.mjs`. Resolver secrets: only the page owner sets them, in the page's
Resolvers settings; no script or API takes them, and never ask in chat. ACLs and trash have no
script. Groups: `node scripts/groups.mjs list`
([groups](references/groups.md)).

- **New page.** Copy the starter that fits and follow its Usage: `cp examples/deck.html
  index.html` (decks); `node scripts/new-app.mjs --title "NAME"` (shared edits: everyone's
  changes are dataset rows, which its resolver checks before writing; it sets up the files,
  datasets and rules and prints the next step); `node scripts/new-app.mjs --kind list --title
  "NAME"` (a list people add themselves to and change only their own entry: sign-up sheet, RSVP,
  roster); `node scripts/new-app.mjs --kind api --url URL --title "NAME"` (an HTTP API's items
  behind a key, grouped with totals, with notes signed-in readers share);
  `node scripts/new-page.mjs --data FILE.csv --title "NAME"` (a page that shows a CSV:
  dashboard, report or chart; it publishes the dataset and writes a DATA block over its columns,
  and `--artifact ID` rebuilds an existing page); `cp examples/report.html index.html` (a report
  without data). Other data
  from an HTTP API or behind a key comes through a resolver ([resolvers](references/resolvers.md),
  read it first): never copy its rows into a CSV. If no starter fits, write the page yourself.
  Keep the starter's design system unless the user names one; then set its `<meta
  name="artifactbin:design-system" content="NAME">` to a name from the table (the platform serves
  its stylesheet and fonts). Keep state through `client` from `@afbin/apollo`
  ([runtime](references/runtime.md)).
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
  a rebuild: copy that starter as under New page, then publish it over the page with `node
  scripts/publish.mjs index.html --artifact ID` instead of the starter's plain publish. Any other
  change (wording, numbers, a section) is an edit: `node scripts/read.mjs ID --output page.html`,
  edit that file, then `node scripts/publish.mjs page.html`; keep editing and publishing that same
  file and never regenerate the page from scratch. A "document" at a link is such a page. Only text
  inside a `data-af-editable` region (a doc) is the exception, since people may be typing in
  it: `node scripts/doc.mjs read ID --output doc.md`, edit doc.md, then `node scripts/doc.mjs
  write doc.md`, which merges your edit with their
  typing ([live docs](references/live-docs.md)).
- **Check.** A starter's Usage names its steps files and check command; add a step for each
  requested value they don't check. Without a starter, write one short steps file of
  `step('label', …)` checks (wait for your data, check the requested values and behaviour), then
  `node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs`.
  Always check before replying, even while a resolver secret is unset. Publish autofixes the page
  and prints an `autofix:` report to read (`node scripts/autofix.mjs FILE` for a file you aren't
  publishing). Never rerun an unchanged check that failed a step or the page:
  change the steps or the page first. Only when the user asks for a private draft: `node
  scripts/serve.mjs PROJECT_DIR`, then check its local URL (`node scripts/serve.mjs --help`).
- **Answer comments.** A comment from someone the page is shared with is a new request, even when
  an earlier request limited what to change: make the change without asking first, publish, then
  `node scripts/comment.mjs reply ID --thread T --body
  TEXT`.
- **Data, apps, exports.** A page built from a CSV publishes it as a dataset first
  ([datasets](references/datasets.md)). A page that shows a dataset links it (`<link
  rel="af-dataset">`) and computes its numbers from its rows in page script
  ([datasets](references/datasets.md#read)); charts use Vega-Lite
  ([dataviz](references/dataviz.md)). For sample data copy
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
| Data/media | `af-data-table`, `af-file-upload`; typing in a dataset cell together: `@afbin/collab`
  ([datasets](references/datasets.md#type-together-afbincollab)) |

For charts, maps and diagrams, use the direct library APIs rather than a custom element:

| Need | Guide |
|---|---|
| Analytical charts or custom chart layouts | [Vega and Vega-Lite](references/dataviz.md) |
| Interactive maps and geospatial layers | [deck.gl](references/maps.md) |
| Flowcharts, sequences and other diagrams | [Pele](references/diagrams.md) |

## Sharing and access

A link never carries your login: whoever opens it signs in as themselves. Group, sharing and
ownership changes alone need no comment watch. Visibility only controls who can read; editing,
comments and dataset writes are separate permissions. A receipt's `user_page_url` is an anonymous
read-only copy ([groups](references/groups.md#public-view-receipts)).

- Pages are unlisted by default: anyone with the link can open them, so "my team can view" needs
  nothing more. Use `--visibility public` or `--visibility private` only when the user says
  "public" or "private"; a private page opens only for the people it is shared with.
- "Share it with my team" naming a group: `node scripts/groups.mjs share PAGE12 --group
  design_crit --role viewer`. Ownership and owner host stay unchanged; use commenter for comments.
- "Put it in team space": after user confirmation, `node scripts/groups.mjs move PAGE12 --group
  design_crit --yes`. `publish.mjs page.html --group design_crit` creates new group-owned work.
- Group administration needs the user's consent in this conversation
  ([groups](references/groups.md)).
- "Let readers submit something": a readable page grants no writes; give the dataset rules for
  viewer and signed_in with `policy.mjs` ([permissions](references/permissions.md)). The page then
  writes rows directly; add a resolver mutation with `@auth` only when writes need checks
  ([resolvers](references/resolvers.md)).

## Preserve the document

Every saved page version remains available. HTML `id` remains available for ordinary browser
anchors and selectors. Initial viewer state goes in `<script type="application/json"
data-af="state">`; comments save its fields as the reader's view, so keep typed text out of it or
list it in `data-af-comment-exclude` ([saved views](references/runtime.md#saved-comment-views)).
Page scripts execute on the page's runner origin, separately from account credentials.

## Installed resources

[% if shipped %]Commands stage updates hourly; when notified, reread SKILL.md and reload your
harness (`node scripts/update.mjs --help`). Scripts are helpers inside this skill, not global
commands; keep your own pages outside it.
[% else %][Download the author skill]([[ base ]]/skills/artifactbin.zip) and install it with the
managed recipe in https://artifactbin.dev/install.sh, which enables updates; reload skills after
installing.
[% endif %]