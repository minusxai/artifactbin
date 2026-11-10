import path from 'node:path';
import type {BundleReceipt} from './execute';
/** What a page's saved metadata records of its publication (lib/publish): its files' receipts and the entry's project path. */
export interface PublicationRecord {htmlPublicationDependencies?:readonly BundleReceipt[];htmlPublicationEntryPath?:string}
/**
 * The page core's file table (html-runtime config `files`, read by html-runtime fn-fetch): each file the page's own
 * publication recorded, keyed by the path a script on the page fetches it by, to where it is read. Keys are relative
 * to the page (its entry's folder; a page published before the entry was recorded sits at its project's root), with
 * `%`, `?` and `#` escaped so the browser's URL parser reads each as one path, however the author spelled it.
 * `address` names a receipt's address: by default the page's own asset door at `version`, which checks on every
 * request that its reader may read the page (./assets serveBundleAsset); an offline copy gives the bytes. Datasets
 * are read through `sql`, never fetched. No receipt, no table.
 */
export function publishedFileTable(meta:PublicationRecord,pageId:string,version:number,address:(receipt:BundleReceipt)=>string|null=receipt=>`/a/${pageId}/assets?dependency=${receipt.id}&revision=${receipt.revision}&version=${version}`):Record<string,string>|undefined{
 const folder=path.posix.dirname(typeof meta.htmlPublicationEntryPath==='string'?meta.htmlPublicationEntryPath:'index.html'),table:Record<string,string>={};
 for(const receipt of Array.isArray(meta.htmlPublicationDependencies)?meta.htmlPublicationDependencies:[]){
  if(receipt?.kind!=='asset'||typeof receipt.path!=='string'||typeof receipt.id!=='string')continue;
  const to=address(receipt);if(!to)continue;
  table[path.posix.relative(folder,receipt.path).replace(/[%?#]/g,character=>encodeURIComponent(character))]=to;
 }
 return Object.keys(table).length?table:undefined;
}
