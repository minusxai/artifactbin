/**
 * The stamp every rendered element carries: its path in the document's AST.
 *
 * Its own module, tiny and dependency-free, because two very different things
 * need it. The WYSIWYG maps a DOM edit back to the source node through it (via
 * the interpreter, which re-exports it), and the served document's scroll
 * anchor names the reader's place with it — and that anchor ships in a
 * ~1 KB script every document loads, which must not pull React in behind a
 * single string constant.
 */
export const AST_PATH_ATTR = 'data-mx-ast';
