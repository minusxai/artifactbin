---
name: artifactbin
description: >-
  Create, edit, publish, comment on, query or export Artifactbin artifacts. Use for artifactbin.dev (or self-hosted) links, work on an Artifactbin document, dashboard, deck, dataset, plan, landing page or app. Use the author skill and authenticated HTTP API contracts.
---
## Read first

A page is a normal HTML file. Use ordinary HTML, CSS, JavaScript, SVG and chosen browser libraries. Import `@afbin/apollo` and every hosted library as `@afbin/<name>` (`vega`, `vega-lite`, `pele-*`, `deck-gl`, `three`, `highlight`); that prefix is reserved. `@afbin/highlight` exports `highlightAll(root)` for `pre > code.language-*`. No JSX, framework compilation, injected state globals or account credentials belong in a page.

Server: [[ base ]]. Reuse this origin’s saved credentials; `node scripts/auth.mjs` signs in and refreshes (read the top of it). Missing credentials do not mean a new account. If sign-in is required, reuse an email already provided; otherwise ask for it, request the emailed code and wait. Never invent an identity.

Direct HTTP, only if a script cannot: create with `POST /api/artifacts`; replace with `PUT /api/artifacts/ID`, observed `expectedVersion` and `expectedState`, and a durable `Idempotency-Key`. On 409, read the new head and reconcile; never attach it to stale source.

## You write / the platform adds

- **You write:** a normal HTML file; one `<meta name="artifactbin:design-system" content="NAME">`; imports from `@afbin/<name>` (`apollo`, `highlight`, the libraries); your own CSS and JS; a `data-af-id` only to keep ones you were given.
- **The platform adds:** the core runtime and import map, the design-system stylesheet and fonts, the `<html>` design and dark-mode attributes, stable `data-af-id`s (carried forward on edits), autofix of common mistakes (reported as `autofix:`), code-highlighting colours, reader presence and comments, and the owner's design-system picker. A core tag, `<html data-af-*>` attributes or a copied stylesheet link you write anyway still works: publish moves or removes them.

## Core flows

Every script takes `--help`, `--server ORIGIN`, `--json` and an exclusive `--output FILE`. To learn one, read the top of it (`head -30 scripts/NAME.mjs`: purpose, usage, flags, examples, gotchas; `--help` prints the same text). Use these scripts, never shell-built HTTP wrappers. Reuse the saved sign-in (`node scripts/auth.mjs status`; its top covers login and refresh). Groups, ACLs, secrets and trash have no script.

- **New page.** Your next action is writing `index.html`: copy the closest example and edit it (decks `cp examples/deck.html index.html`, dashboards `examples/csv-dashboard.html`, shared apps or backends `examples/shared-app.html`), a compact first version (about 30 KB). Plan in at most ~5 lines with no CSS, JS or copy in your reasoning. Pick one design system from the table and name it in `<head>` with `<meta name="artifactbin:design-system" content="NAME">`; the platform serves the stylesheet, sets the `<html>` attributes and hosts the fonts, so copy and link nothing. `design-systems/NAME.css` has its exact tokens, type-role classes (`t-title`, …) and what each colour is for. Keep state through `client` from `@afbin/apollo` ([runtime](references/runtime.md)). Optionally preview with `node scripts/serve.mjs ./project`, then `node scripts/publish.mjs index.html`; it autofixes the page and prints an `autofix:` report to read (`node scripts/autofix.mjs FILE` only for a file you aren't publishing). Publish as soon as the first version renders and share the returned URL before extending it; a URL-only request gets the URL alone.
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
  - Decks: `examples/deck.html` has the `data-af-slide` sections, the `data-af-deck-chrome` nav, keys and a height budget per slide. Slides are designed for 1200x630: check decks with `--viewport 1200x630 --viewport 1280x800` only, and reply with `slide=N` links (`export.mjs --slide N`) instead of testing exports.
  - Never put a bearer, refresh token or session cookie in HTML, state, scripts, examples or downloaded files. Use authenticated account identity, never a name typed into a form, to authorize actions.
- **Check.** `node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs --output qa-1.json` (a new `--output` name each run; decks as above). Write one short steps file that waits for your data and checks the requested values and behaviour; set values explicitly and `waitForFunction` the expected text after each click. Fix only what fails, rerun once. The summary is your layout evidence (no own pixel scripts or re-exports): after one passing steps run that covers the requested behaviour, with no errors, overflow, contrast, clipping, overlap or duplicate ids, reply with the link and what you tested, then stop. Republish only to fix a failed requirement, never for polish, refactors or extra verification. Open screenshots only if your model accepts image input; if not, say appearance is unverified.
- **Edit a page.** `node scripts/read.mjs ID --output page.html`, edit that file, then `node scripts/publish.mjs page.html`; keep editing and publishing the same file and never regenerate the page from scratch. Publish rewrites the file with `data-af-id`s: re-read it before editing and match on short anchors, not whole lines. Keep every existing `data-af-id`; new static elements may omit it. Elements your script creates (list rows, cards, table rows, labels) each need a `data-af-id` that is unique on the page and identical on every render, built as `<list>-<record id>-<role>`: `item.dataset.afId='budget-row-'+tx.id; amount.dataset.afId='budget-row-'+tx.id+'-amount'`. Use a distinct prefix per list and role; never an array index, display text, sort order or random value; never reuse a saved or deleted ID; mount them under a container present in the saved HTML ([dynamic elements](references/runtime.md#dynamic-elements-and-comments)).
- **Answer comments.** `node scripts/comment.mjs list ID`. If a comment asks for a change, make the edit first, then `node scripts/comment.mjs reply ID --thread T --body-file reply.txt` (add `--resolve --expected-revision R` when done). Anchors are described at the top of `comment.mjs`.[% if not shipped %] Direct-HTTP agents: [authentication](references/http-auth.md) and [comment anchors and browser sessions](references/html-operations.md).[% endif %]
- **Monitor.** `node scripts/comment.mjs watch ID` streams new comments.
- **Data, apps, exports.** CSV and datasets: [datasets](references/datasets.md); sample data is a seeded generator of ≤40 lines making ~150–400 rows shaped like `examples/repairs.csv`, labelled as sample. Shared apps and backend files: [backends](references/backends.md) (read before modeling identity or writes; a readable page grants no dataset write access). `node scripts/graphql.mjs schema ID` for the linked schema, `node scripts/export.mjs ID --format html --output copy.html` for a portable copy.
- **Network and install.** To call an external API add `<meta name="csp-connect" content="https://api.example.com">` in `<head>` (also `csp-script`, `csp-style`, `csp-img`, `csp-frame`, `csp-media`); readers are asked to allow new origins and publish rejects invalid declarations. For an installable page use the `artifactbin:pwa-enabled`, `-name`, `-short-name`, `-theme-color`, `-background-color` and `-icon` metas in `<head>`; autofix explains invalid values.

## Optional HTML components

Copy the installed `components/` directory into the project (all of it: helpers and engine chunks come along) and import the compiled `.js` registrations, e.g. `import {registerInput} from './components/input.js'; registerInput();`; repeat calls are safe. To learn an element, read the comment at the top of its `.ts` (`head -30 components/NAME.ts`: import line, attributes, events, usage); the `.ts` is readable source, not a browser script. Most controls emit a bubbling `af-change` with `event.detail.value`: keep the value in Apollo state, set it back on the element (switch `checked`, overlays and collapsible `open`, slide deck `index`, the rest `value`) and unsubscribe when the view goes away. Elements use light DOM and the page's design-system tokens, carry no credentials, and need explicit registration. New diagrams and maps use the direct libraries below, not the legacy `af-mermaid` and `af-deck-gl` wrappers.

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
