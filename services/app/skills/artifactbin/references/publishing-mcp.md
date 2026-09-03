---
name: publishing-mcp
description: >-
  The MCP server (same API as tools), OAuth or a bearer header. Read to connect an MCP client.
order: 5
---
## Read first

artifactbin: publish self-contained documents (reports, dashboards, slides, datasets, charts, images) and share the returned URL with your user — that url is the deliverable.

Publish before you polish: make your FIRST create_artifact a SKELETON — the real title, the theme and template you picked, the document's section headings, stubbed — and hand your user that url at once, saying it is live and still filling in. It is: an edit reaches an open reader in seconds, so they watch the sections land. Only then read the docs below, and fill each section with edit_artifact as you go. The reading path never precedes the first publish. (Rows, images and viz recipes are the one thing that goes up before the skeleton that binds them.)

Quick rules:
- Every artifact takes exactly ONE content field: markup | dataset | viz | image.
- markup is THE document format: static JSX over the component kit, plain HTML tags for everything else (prose included), and ONE top-level <Helmet> for <title>/<style>/<script>. There is no separate markdown or html tier.
- Create dataset/viz/image artifacts first. A dataset is read by SQL — <Query name="q">{`select … from ref_<id>`}</Query> in <Helmet>, bound as data="$q"; images and recipes bind as ref:<id>.
- update_artifact fully replaces content at a stable URL; every save is versioned and revertible; edit_artifact changes one node and needs the edit_id from your last read.

With the skeleton up, read the docs over plain HTTP (no auth needed) — small files, critical content at the top of each:
- [[ base ]]/docs/artifactbin/SKILL.md — the brief: everything a straightforward document needs. Read it first.
- [[ base ]]/docs/artifactbin/references/markup.md — the document vocabulary; markup-data.md beside it is the data grammar in full.
- [[ base ]]/docs/artifactbin/references/templates-<name>.md and …/themes-<name>.md — AFTER picking a template and a theme, the chosen one in full.
- [[ base ]]/docs — the whole tree listed with a one-line "when to read" per file.

## The MCP server

`[[ base ]]/mcp` — a Streamable HTTP MCP server speaking this exact API
([[ opNames ]] — one tool per operation, from the same registry the HTTP routes run).
It supports OAuth: add it with no credentials and the client pops a browser
where your user logs in with their email (a one-time code — no password) and
approves. Artifacts published through the connection belong to that account:

```
claude mcp add --transport http artifactbin [[ base ]]/mcp
```

Already have an `mx_` token? Skip the browser: pass it as a header instead
(`--header "Authorization: Bearer mx_..."`) — the tokens are interchangeable.
The HTTP reference in [publishing.md](publishing.md) doubles as the tools' semantics:
content tiers, the edit protocol, and what each error means.
