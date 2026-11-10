/** New-document expectations shared by the browser gate and its deterministic PR contract test. */
export const NEW_DOC_KIND = 'rich-native-v1';
export const NEW_DOC_REGION = `article[data-af-editable="${NEW_DOC_KIND}"]`;
export const NEW_DOC_HTML = new RegExp(`<article data-af-editable="${NEW_DOC_KIND}"[^>]*><h1[^>]*></h1><p[^>]*></p></article>`);
export const NEW_DOC_EDITOR = `${NEW_DOC_REGION} > .tiptap`;
