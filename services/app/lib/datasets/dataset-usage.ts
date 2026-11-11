/** A dataset's create-response fields, and the catalog copy action's link a page reads it through. */
const attr=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
/** Stored datasets are linked by ID; the link's `data-af-name` is the dataset's table name in the page's sql. */
export function datasetQuerySnippet(id:string,name='data'):string {
 return `<link rel="af-dataset" data-af-name="${attr(name)}" href="ref:${attr(id)}">`;
}
/** Create-response contract: a dataset's shape and the ref a page links it by. */
export function datasetCreateFields(id:string,columns:unknown,rowCount:unknown,meta?:{totalRows?:number;truncated?:boolean},access:'read'|'readwrite'='read') {
 return {columns,rowCount,access,
  ...(meta?.truncated?{totalRows:meta.totalRows,truncated:true,note:`Source had ${meta.totalRows} rows; the first ${rowCount} were kept.`}:{}),
  ref:`ref:${id}`,
 };
}
