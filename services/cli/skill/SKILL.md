---
name: artifactbin
description: Publish and edit shareable documents, dashboards, presentations and datasets with the artifactbin CLI; read and respond to artifact comments.
---

# artifactbin

Use `afbin` with local files. `afbin -h`, command `-h`, and `afbin help <topic>` work offline. If the binary is missing, download `https://artifactbin.dev/chat/install.sh` and run it with `sh`; the installer verifies the released standalone binary’s checksum. Authentication and local skill updates belong to `afbin setup`. It requests browser approval and saves credentials privately in `~/.artifactbin/.env`. In automation, `setup --yes --json` reports the pending approval URL; `--yes` never grants browser approval. Never self-mint credentials or expose tokens in output.

For a supplied artifact, run `afbin pull <url-or-id> report.jsx`, edit that file, then `afbin push report.jsx`. For a new artifact, write a `.jsx` file and use the same push command. Share its returned URL according to the user's request. Preserve its identity; creating another artifact is a deliberate fork.

Documents are self-contained static JSX with HTML prose, not Markdown or React programs. Keep interactions native; use `<Iframe>` only for isolated DOM-script/canvas widgets. No CDN scripts, external stylesheets, `<form>` or `<iframe>`. Use `className`, not inline style. A top-level `<Helmet>` holds document CSS, scripts and data declarations. Every body element has a persistent `id` for its lifetime. Move a node with the same id; never reuse an id for a different node. A leading YAML fence holds `title`, `theme`, `template`, `visibility`, `link`, `folder` and sync identity. Let the CLI maintain `id`, `edit_id`, `head_version`, `state` and `version`. To fork, copy the file and remove those five identity fields.

Use `afbin validate report.jsx` locally before publishing; `validate --fix` applies mechanical fixes. `status` and `diff` use saved state. Add `--remote` only to refresh a comparison. An unchanged push makes no request. `push --dry-run` performs authoritative server validation without publishing or saving state.

A CLI reference is `<url|id|path>[@version]`; an existing complete filename wins. Published references inside markup use `ref:<id>`. Relative dependency paths stay local while authoring and become canonical refs on publication. CSV/JSON rows are datasets: put ``<Query name="sales" source="./sales.csv">{`select * from public.rows`}</Query>`` inside `<Helmet>`, then bind `<Table data="$sales" />`. `$sales` names a query result, not a file. SQL names tables, not artifact IDs.

Before writing, read design, markup, then the selected template and theme guidance below. Template frames prevent content sitting flush to the viewport edge. Prefer `Grid mode="flow"` / `GridItem w={6}` for columns and sidebars; leave prose unwrapped. Use container prefixes: `grid-cols-1 @2xl:grid-cols-2` and `text-3xl @2xl:text-5xl` start at phone width. For dataviz, read `references/markup-data.md` first; use Vega/Vega-Lite or recipes, never a hand-rolled `<svg>` chart. Only export screenshots if you can view images; otherwise check markup.

Read only the guidance the task needs:

- [Design](references/design.md), [markup and components](references/markup.md), [data and controls](references/markup-data.md).
- `afbin help themes` and `afbin help templates` list bundled choices. `afbin help dashboard`, `editorial`, `deck` or `scrolly` prints an example. Detailed guides are in `references/templates-<name>.md` and `references/themes-<name>.md`.
- [Sync and recovery](references/publishing.md), [comments](references/publishing-annotations.md), [authentication](references/publishing-auth.md).
- [Advanced HTTP operations](references/api.md), [database catalogs](references/databases.md), [files and datasets](references/publishing-datasets.md).

`afbin comment <ref>` lists threads; `--quote TEXT --body TEXT` starts one, and `--reply THREAD --body TEXT --resolve` answers and resolves it. `afbin log <ref>` reads history. `afbin delete <ref>` deletes remotely and retains local files.

Use `--json` for structured results. On refusal, follow the returned code, field/location and recovery instruction; local help explains the same rules. A conflict preserves your file. `pull --force` overwrites local changes, so preserve a wanted proposal first. `push --force` observes and conditionally replaces the remote head; it never fixes markup. For an uncertain write, retry push so its frozen request can recover the original result.

For a refusal or interrupted write, read [errors and recovery](references/errors.md). Preserve the returned code, fix and pending request record.

For an existing Markdown draft, see [one-time import](references/markdown.md). Push converts it to adjacent JSX; subsequent edits belong in that JSX file.
