---
name: templates-doc
description: A plain document for notes, drafts and everyday writing.
---
## Read first

[[ template.description ]]

Use `template: doc` for a quick document, meeting notes, a draft or an everyday
text page. It is the simplest writing surface: one headline and a flowing body.
Keep the selected type when filling a document someone created in the app.
Pull and edit that existing artifact; do not create a replacement.

Docs default to the Meridian design system and a centered reading column with
768px of content width. The page provides its gutters; do not add another outer
width or padding wrapper. An explicit `theme` can choose a different system.
Use `<Markdown>` for the main document body. Keep continuous prose, including
headings, paragraphs and lists, together in one component so users can edit it
as one rich-text document. Split around charts, images or other embeds,
not around each paragraph. Use `#`, `##` and `###` for title, sections and
subsections; Contents follows those headings while reading and editing.
HTML is still available for custom title areas and individually designed text.
Markdown inherits the design system's fonts and colors with a transparent background.

```jsx
<article id="document" data-design="tw">
  <Markdown id="body">{`# Project notes

Start with the information the reader needs.

## Next steps

- Record the decision.
- Assign the follow-up.`}</Markdown>
</article>
```

`<Markdown id="body">{\`## Overview\n\nA **bold** point.\`}</Markdown>` is a
themed rich-text region edited with Lexical. It supports headings, paragraphs,
nested lists, checklists (`- [ ]` / `- [x]`), horizontal rules (`---`), GFM tables,
quotes, links, bold, italic, strikethrough and inline/fenced code. Table cells
sit outside lists and quotes and support inline formatting and `<br>` line breaks; the first row is the header.
Checklists are interactive in edit mode. Keep images, raw HTML (except table
line breaks) and reference-style links outside it;
unsupported constructs are rejected rather than lost on editing. Props and
content must be literal; Markdown regions do not belong in row templates.
Style the whole region with `className`; text-level controls only offer formats
that survive Markdown saving. Existing HTML content remains supported. Markdown typing shortcuts apply only
inside `<Markdown>`; HTML text keeps markers literal and uses the sidebar for formatting.

Do
- Prefer one Markdown region for each long stretch of continuous text.
- Use a comfortable reading width and restrained typography.
- Preserve existing node IDs and the user's writing when extending a draft.
- Add sections, images or tables only when they help the document.

Don't
- Turn a quick note into a landing page or a designed magazine feature.
- Add sample facts, decorative cards or a cover before the real content.
- Save editor placeholders or copy-for-agent controls into published content.

For a composed long-form report or article, see [templates-editorial.md](templates-editorial.md).

## Context

Publish background, assumptions or methodology as a regular Doc, then reference it
with one `<Context src="ref:<documentId>" />` directly inside `<Helmet>`. Every page type has a **Context** tab. When empty it says **No additional context**;
choose **Add context** and paste a Doc link, ID or `ref:ID` from the same server.
**Change context** lets you replace or remove the reference. The tab displays the current document; **Open document** opens its artifact
page for normal editing. Context stays out of the main presentation and visual
exports. The linked Doc keeps its own history and permissions: attaching it grants
no access, and forks keep the same reference. Pull the referenced Doc separately
when you need its contents (`afbin pull <documentId> --output context.jsx`).
Context is a reference only: no inline content or extra attributes.
