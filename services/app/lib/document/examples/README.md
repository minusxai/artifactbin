# Website editing fixture

`cult-pitch.mdx` reproduces [the supplied cult pitch-training artifact](https://app.artifactbin.dev/a/9sB3GK), version 82. Its text, artwork, authored CSS, IDs, and responsive layout are retained. Prose headings and paragraphs are Markdown nodes; layout stays styled MDX. Images are embedded so the local demo does not depend on the original artifact server. The fonts and their licenses are in `public/assets/mdx-demo`.

The root's `layout: "canvas"` property selects native HTML rendering without editor layout wrappers. This is a document property, not a second persistence or editing model. Both layouts use the same ProseMirror tree, normalized JSONB, operations, and artifact history.

Open `/documents/new?example=case-study` to create your own editable copy. The example is not a claim of authorship; the source article's byline and content are preserved.
