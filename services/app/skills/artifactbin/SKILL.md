---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev
  (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing
  page or app. Use the author skill and authenticated HTTP API contracts.
---
## Read first

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries.
Import `@afbin/apollo` and every hosted library as `@afbin/<name>` (`vega`, `vega-lite`, `pele-*`,
`deck-gl`, `three`, `highlight`) and the optional components below the same way; that prefix is
reserved. `@afbin/highlight` exports `highlightAll(root)` for `pre > code.language-*`. No JSX,
framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; `node scripts/auth.mjs` signs in and
refreshes (read the top of it). Missing credentials do not mean a new account. If sign-in is
required, reuse an email already provided; otherwise ask for it, request the emailed code and wait.
Never invent an identity.

Direct HTTP, only if a script cannot: create with `POST /api/artifacts`; replace with
`PUT /api/artifacts/ID`, observed `expectedVersion` and `expectedState`, and a durable
`Idempotency-Key`. On 409, read the new head and reapply.

## You write / the platform adds

- **You write:** a normal HTML file; one `<meta name="artifactbin:design-system" content="NAME">`;
  imports from `@afbin/<name>` (`apollo`, `highlight`, the libraries); your own CSS and JS; a
  `data-af-id` only to keep ones you were given.
- **The platform adds:** the core runtime and import map, the design-system stylesheet and fonts,
  the `<html>` design and dark-mode attributes, stable `data-af-id`s (carried forward on edits),
  autofix of common mistakes (reported as `autofix:`), code-highlighting colours, reader presence
  and comments, and the owner's design-system picker. A core tag, `<html data-af-*>` attributes or a
  copied stylesheet link you write anyway still works: publish moves or removes them.

## Core flows

Every script takes `--help`, `--server ORIGIN`, `--json` and an exclusive `--output FILE`. To learn
one, read `head -30 scripts/NAME.mjs` (usage, flags, examples, gotchas; `--help` prints the same).
Use these scripts, never shell-built HTTP wrappers. Reuse the saved sign-in
(`node scripts/auth.mjs status`). Groups, ACLs, secrets and trash have no script.

- **New page.** 1) Run one copy now: `cp examples/deck.html index.html` (decks),
  `cp examples/shared-app.html index.html && cp examples/garden.ts .` (dashboards with shared edits,
  apps with a backend) or `cp examples/csv-dashboard.html index.html` (read-only dashboards). 2)
  Edit only the data block at the top (`SLIDES` in the deck; `APP` and `garden.ts`'s names in the
  shared app; the `[bracketed]` text elsewhere): never rewrite the template's CSS, JS or layout, and
  never draft copy in reasoning. 3) Publish it unchanged and let check find faults. The template
  already uses its design system's tokens, so don't read the design-system CSS; to switch systems,
  change the `<meta name="artifactbin:design-system" content="NAME">` from the table (the platform
  serves the stylesheet and fonts). Keep state through `client` from `@afbin/apollo`
  ([runtime](references/runtime.md)). `node scripts/publish.mjs index.html` autofixes the page and
  prints an `autofix:` report to read (`node scripts/autofix.mjs FILE` only for a file you aren't
  publishing). Share the returned URL; a URL-only request gets the URL alone.
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
  - Design: start from the reader's decision; give the opening a concrete point and let typography
    set the hierarchy (no identical cards for every paragraph). Use real data in charts, label
    assumptions, keep lines under about 80 characters and controls keyboard-usable.
  - Decks: `examples/deck.html` has the `data-af-slide` sections, the `data-af-deck-chrome` nav,
    keys and a height budget per slide. Slides are designed for 1200x630: check decks with
    `--viewport 1200x630 --viewport 1280x800` only, add no export button and fetch no export URLs
    ("slides N exportable" is enough); reply with the slide image links the check prints.
  - Never put a bearer, refresh token or session cookie in HTML, state, scripts, examples or
    downloaded files, and never print or cat credential files (the scripts read them). Use
    authenticated account identity, never a name typed into a form, to authorize actions.
- **Check.** Before publishing, copy the example's ready steps (`examples/deck-steps.mjs`;
  `shared-app-steps.mjs`, `-guest.mjs`, `-cleanup.mjs`), or write one short steps file of
  `step('label', …)` checks: wait for your data, check the requested values and behaviour. Then
  publish and check in one command: `node scripts/publish.mjs index.html && node scripts/check.mjs
  index.html --steps steps.mjs --output qa-1.json` (a new `--output` name each run; decks as above;
  with shared writes add `--guest-steps guest.mjs --cleanup-steps cleanup.mjs`). Hosted checks run
  in a server browser: never install Playwright or Chromium (only a local
  `node scripts/serve.mjs DIR` preview needs `--playwright-module`). Fix only what fails, rerun
  once. After one clean steps run covering the requested behaviour (the summary is your layout
  evidence; no pixel scripts or re-exports), reply with the link, then stop. In your reply, describe
  testing only by quoting check's `Verified:` line; claim nothing else as tested. Republish only to
  fix a failed requirement, never for polish, refactors or extra verification. Open screenshots only
  if your model accepts image input; otherwise the reply says appearance is unverified. For a shared
  app, the reply also says how others get access: open the link and sign in to edit.
- **Edit a page.** `node scripts/read.mjs ID --output page.html`, edit that file, then
  `node scripts/publish.mjs page.html`; keep editing and publishing the same file and never
  regenerate the page from scratch. Publish rewrites the file with `data-af-id`s: re-read it before
  editing and match on short anchors, not whole lines. Keep every existing `data-af-id`; new static
  elements may omit it. Elements your script creates (list rows, cards, table rows, labels) each
  need a `data-af-id` that is unique on the page and identical on every render, built as
  `<list>-<record id>-<role>`: `item.dataset.afId='budget-row-'+tx.id;
  amount.dataset.afId='budget-row-'+tx.id+'-amount'`. Use a distinct prefix per list and role; never
  an array index, display text, sort order or random value; never reuse a saved or deleted ID; mount
  them under a container present in the saved HTML ([dynamic
  elements](references/runtime.md#dynamic-elements-and-comments)).
- **Answer comments.** `node scripts/comment.mjs list ID`. If a comment asks for a change, make the
  edit first, then `node scripts/comment.mjs reply ID --thread T --body-file reply.txt` (add
  `--resolve --expected-revision R` when done). Anchors are described at the top of
  `comment.mjs`.[% if not shipped %] Direct-HTTP agents: [authentication](references/http-auth.md)
  and [comment anchors and browser sessions](references/html-operations.md).[% endif %]
- **Monitor.** `node scripts/comment.mjs watch ID` streams new comments.
- **Data, apps, exports.** CSV and datasets: [datasets](references/datasets.md); for sample data
  copy `examples/gen-transactions.mjs`, adjust its categories, payers and merchants, and run it once
  (about 300 rows, never over 400, labelled as sample); it ships as generated: never retune or
  republish it. Shared apps and backend files: [backends](references/backends.md) (read before
  modeling identity or writes; a readable page grants no dataset write access).
  `node scripts/graphql.mjs schema ID` for the linked schema,
  `node scripts/export.mjs ID --format html --output copy.html` for a portable copy.
- **Network and install.** To call an external API add `<meta name="csp-connect"
  content="https://api.example.com">` in `<head>` (also `csp-script`, `csp-style`, `csp-img`,
  `csp-frame`, `csp-media`); readers are asked to allow new origins and publish rejects invalid
  declarations. For an installable page use the `artifactbin:pwa-enabled`, `-name`, `-short-name`,
  `-theme-color`, `-background-color` and `-icon` metas in `<head>`; autofix explains invalid
  values.

## Optional HTML components

Components are hosted modules, like the libraries: `import '@afbin/input';` registers its elements
(an import per component you use; nothing to copy or call). To learn an element, read the comment at
the top of its source (`head -30 components/NAME.ts`: import line, attributes, events, usage); the
`.ts` is readable reference, not a browser script. Most controls emit a bubbling `af-change` with
`event.detail.value`: keep the value in Apollo state, set it back on the element (switch `checked`,
overlays and collapsible `open`, slide deck `index`, the rest `value`) and unsubscribe when the view
goes away. Elements use light DOM and the page's design-system tokens and carry no credentials.
Diagrams and maps use the direct libraries below.

| Purpose | Elements (see `components/NAME.ts`) |
|---|---|
| Controls | `af-button`, `af-input`, `af-textarea`, `af-slider`, `af-switch`, `af-select`,
  `af-segmented`, `af-date-picker` |
| Navigation/disclosure | `af-tabs`, `af-accordion`, `af-collapsible` |
| Overlays | `af-dialog`, `af-popover`, `af-tooltip` |
| Identity/status | `af-avatar`, `af-user`, `af-icon`, `af-progress` |
| Prose/diagrams | `af-markdown`, `af-isometric` |
| Data/media | `af-data-table`, `af-file-upload` |
| Slides | `af-slide-deck` (with `af-slide`) |

For native HTML visualizations, use the direct library APIs rather than a custom chart or map
element. Choose the guide that fits the work:

| Need | Guide |
|---|---|
| Analytical charts or custom chart layouts | [Vega and Vega-Lite](references/dataviz.md) |
| Interactive maps and geospatial layers | [deck.gl](references/maps.md) |
| Flowcharts, sequences and other diagrams | [Pele](references/diagrams.md) |

## Sharing and access

A link never carries your login: whoever opens it signs in as themselves. Visibility only controls
who can read; editing, comments and dataset writes are separate permissions.

- "Make it public": `node scripts/publish.mjs page.html --visibility public`. Keep the default
  (unlisted) unless the user asks for public.
- "Share it with my team": `node scripts/publish.mjs page.html --group HANDLE`. Group editors can
  edit, viewers can read.
- "Let readers submit something": a readable page grants no writes; use a backend mutation with a
  role directive ([backend permissions](references/backends.md)).

## Preserve the document

Every saved page version remains available; never reuse a removed ID. A 409 or a refused baseline
means someone else edited: read again and reapply. HTML `id` remains available for ordinary browser
anchors and selectors. Initial viewer state goes in `<script type="application/json"
data-af="state">`. Page scripts execute on the page's runner origin, separately from account
credentials.

## Installed resources

[Download the author skill]([[ base ]]/skills/artifactbin.zip) and extract its one `artifactbin/`
folder into your harness’s skill directory, then reload skills. Read only the guide needed for the
task:

- [Runtime](references/runtime.md): Apollo local state, remote namespaces and offline behavior.
- [Data visualization](references/dataviz.md): chart choices, truthful encodings, themes and
  Vega/Vega-Lite guidance.
- [Diagrams](references/diagrams.md): Pele rendering of Mermaid syntax, themes, lifecycle and
  offline behavior.
- [Maps](references/maps.md): direct deck.gl layers, view state, resize, cleanup and basemap/data
  limits.
- [Offline images](references/runtime.md#portable-images): download limits.
- [Datasets](references/datasets.md): CSV import, schema discovery and stable dataset IDs.
- [Backend files](references/backends.md): TypeScript resolvers, shared stores and permissions.
- `examples/`: each file's top comment says what it shows and which files go with it.

Only when the user asks for a private draft, run `node scripts/serve.mjs PROJECT_DIR` and
`node scripts/check.mjs http://127.0.0.1:PORT/ --playwright-module FILE` (the preview adds a 76px
toolbar and needs the network; see the top of `scripts/serve.mjs`).

Scripts are helpers inside this skill, not global commands; `preview.mjs` and
`publication-bundle.mjs` are compatibility shims.
