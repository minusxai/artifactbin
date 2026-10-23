---
name: html-design-systems
description: Select and bind one retained design system to ordinary HTML with generated CSS assets.
---
## Read first

Choose one system for the subject and the content’s shape. Read only its native guide. The same specifications generate these assets and the original runtime; do not copy legacy JSX/Helmet recipes into HTML.

| Native guide | Mood | Fits |
|---|---|---|
| [Volta](html-system-volta.md) | Loud | Data products, dashboards, launch pages |
| [Phosphor](html-system-phosphor.md) | Technical | Dev tools, CI, logs, status pages |
| [Drafting](html-system-drafting.md) | Technical | Plans, specs, explainers, process stories |
| [Meridian](html-system-meridian.md) | Sleek, Professional | Product dashboards, docs, SaaS marketing |
| [Dossier](html-system-dossier.md) | Evidential | Plans, reports, post-mortems, long features |
| [Riso](html-system-riso.md) | Printed | Scrolly stories, picture-book explainers, posters, zines |
| [Almanac](html-system-almanac.md) | Warm | Scrolly explainers, landing pages, long reads, annual reports |
| [Redline](html-system-redline.md) | Poster | Slides, decision briefs, launch pages, posters |
| [Nocturne](html-system-nocturne.md) | Atmospheric | Long reads, features, evening and culture subjects |
| [Broadsheet](html-system-broadsheet.md) | Editorial | Features, reports, newsletters, long reads |
| [Signout](html-system-signout.md) | Utilitarian | Booking apps, intake forms, rosters, inventories |
| [Sorbet](html-system-sorbet.md) | Fun | Consumer apps, launches, kids and food, celebrations, playful data |
| [Arcade](html-system-arcade.md) | Fun | Games, launches, leaderboards, playful dashboards, teaching |

## Binding

Download the author skill ZIP to obtain the generated `design-systems/NAME.css` assets. Inline the chosen file in a `<style data-af="design-system">` block and set `data-af-design-system="NAME"` plus `data-af-dark="false"` or `"true"` on `<html>`. This is ordinary source CSS, not a claimed runtime stylesheet URL. Read the native guide for exact tokens and classes.

The stylesheet carries light/dark variables, font faces and typography. Use semantic HTML, ordinary `class` and authored CSS for responsive composition. The original kit components, Tailwind utility compilation and page-type recipes are not part of the native HTML contract. Preserve the system’s color/type choices; adapt its composition to the actual task.

## Design judgment

Start with the reader’s decision and the subject’s own visual material. Give the opening a concrete point, choose one expressive moment and let typography establish hierarchy. Do not turn every paragraph into an identical card. Use real data in charts, label assumptions and make comparisons legible. Keep prose under about 80 characters per line and controls usable by keyboard.

Verify desktop, 390px, long values, missing data, font fallback and both chosen color modes. Reuse the same system when editing an existing page unless asked to redesign it. The [installed examples](html-examples.md) show report, chart and shared-app compositions using these generated assets.
