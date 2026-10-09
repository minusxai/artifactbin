---
name: markdown
description: "Rules and invocations for markdown."
---
## Read first

Run `afbin push report.md` to convert and publish `report.jsx`. The Markdown file stays untouched; edit and push JSX thereafter. A second Markdown push is refused, even if the generated JSX was deleted. An existing JSX destination is never overwritten.

`afbin validate report.md` checks the conversion locally. `afbin push report.md --dry-run` preflights the virtual JSX without writing conversion records, files or remote objects.

Supported: headings, paragraphs, emphasis, lists, block quotes, tables, links, images, fenced/inline code and horizontal rules. Raw HTML/JSX and task checkboxes are refused. Author interactive components directly in JSX. Local file references are refused. Register files with afbin add --json and use their IDs.
