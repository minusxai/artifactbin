/**
 * THE DATA LANGUAGE's reference uses, browser-safe but parser-heavy: what a document's markup
 * references (`ref:` artifacts, images, embeds), read with the JSX parser. Its own entry so the
 * reader islands, which never ask, never load the parser through `./index`; the editor's document
 * graph and local validation do. The publish-time checks over these uses are in `./server`.
 */
export { collectRefUses, findBrokenEmbeds } from './refs';
