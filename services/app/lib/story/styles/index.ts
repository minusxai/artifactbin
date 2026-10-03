/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export { DOCUMENT_ROOT_CSS, DOMAIN_FOOTER_CSS, DOMAIN_FOOTER_TEXT, documentStyleSheets } from './document-styles';
export { fontPreloadTags, readerChromeFonts } from './first-screen-fonts';
export { assetsPath, markupCsp, mutatePath, queryPath } from './markup-csp';
export { buildDocumentCsp, NO_DOCUMENT_CSP_EXTENSIONS } from './document-csp';
export type { DocumentCspExtensions, DocumentCspInput } from './document-csp';
