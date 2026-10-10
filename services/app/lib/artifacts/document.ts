/** The artifact persistence boundary. SQL remains explicit at its owning write path;
 * only stored JSONB↔public JSX conversion lives here. Never issue an
 * out-of-transaction query: callers always supply their own Queryable.
 */
import { createDocumentGraph, type DocumentGraph, decodeDocument } from '../document';
import {currentStoryCss,storyCssCompileVersion} from '../data/story/story-css.server';
import {finalizeArtifactMetadata} from '@/lib/document/server';
import type {Queryable} from '@artifactbin/contracts';
interface SourceRow {source?:string|null;document?:DocumentGraph|null}
/** A markup source is stored as its graph alone; `preserveSource` keeps bytes a validated publish did not produce (a fork, an archive) exactly. */
export function sourceStorage(format:string,source:string|null,certified=false,version=1):{source:string|null;document:string|null} {
 if(format!=='markup'||source===null)return {source,document:null};
 return {source:null,document:JSON.stringify(createDocumentGraph(source,version,certified?{}:{preserveSource:true}))};
}
/**
 * A stored document that does not decode (not a graph, or a graph whose
 * boundaries are broken) is handed back with `source: null` beside it, never
 * thrown: listings and history stay readable, and the doors that serve content
 * refuse the row by name (lib/artifacts/servable).
 */
function decodeArtifactDocument<T>(value:T):T {
 const row=value as T&SourceRow;
 const {document,...rest}=row;
 // A markup row read with an empty `document` keeps the key: it is a retired
 // source-column row, and lib/artifacts/servable judges it by that.
 if(document==null)return ('document' in row&&(rest as {format?:string}).format==='markup'?{...rest,document:null}:rest) as T;
 let source:string|null;
 try{source=decodeDocument(document);}catch{return {...rest,document,source:null} as T;}
 const meta=(rest as {meta?:Record<string,unknown>}).meta;
 return {...rest,document,source,...(meta&&!meta.parsedArtifact?{meta:finalizeArtifactMetadata('markup',source,meta)}:{})} as T;
}
/** Derived rendering data is computed from the committed graph, never a stale
 * admission snapshot. Compilation has no database write or transaction callback. */
export async function hydrateArtifactDocument<T>(value:T):Promise<T> {
 const graph=(value as T&SourceRow).document?.kind==='graph',decoded=decodeArtifactDocument(value);
 const row=decoded as T&{source?:string|null;meta?:Record<string,unknown>};
 if(!graph||!row.meta||row.source==null)return decoded;
 const compiledCss=await currentStoryCss(row.meta,row.source);
 return {...row,meta:{...row.meta,compiledCss,cssCompileVersion:storyCssCompileVersion()}} as T;
}
export async function artifactQuery<T=Record<string,unknown>>(db:Queryable,sql:string,params:unknown[]=[]):Promise<{rows:T[]}> {
 const result=await db.query<T>(sql,params);
 return {...result,rows:result.rows.map(decodeArtifactDocument)};
}
/** The first row of {@link artifactQuery}, or null. */
export async function loadArtifactDocument<T>(db:Queryable,sql:string,params:unknown[]):Promise<T|null> {
 return (await artifactQuery<T>(db,sql,params)).rows[0]??null;
}
