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
Use `h1` for the title, `h2` for sections and `h3` for subsections. Contents
follows those headings automatically, including while the user edits.

```jsx
<article id="document" data-design="tw">
  <h1 id="headline" className="text-4xl font-semibold tracking-tight">Project notes</h1>
  <p id="body" className="mt-6 text-base leading-relaxed">Start with the information the reader needs.</p>
</article>
```

Do
- Keep text editable as ordinary headings, paragraphs and lists.
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
