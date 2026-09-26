/**
 * What an author calls a node, for editor chrome: the toolbar breadcrumb and
 * the drag label name the same thing the same way. Free of React so the
 * document's edit runtime can use it without pulling in the toolbar.
 */
const NODE_NAMES: Record<string, string> = {
  p: 'Paragraph',
  div: 'Container',
  section: 'Section',
  article: 'Article',
  img: 'Image',
  span: 'Text',
  a: 'Link',
  li: 'List item',
  ul: 'Bulleted list',
  ol: 'Numbered list',
  blockquote: 'Quote',
  table: 'Table',
  button: 'Button',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  GridItem: 'Grid cell',
  Question: 'Chart',
};

export const nodeName = (tag: string): string => NODE_NAMES[tag] ?? tag;
