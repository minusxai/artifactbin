/** Persistence reads preserve native source bytes and stored history without converting retired documents. */
import type {Queryable} from '@artifactbin/contracts';
export function sourceStorage(_format:string,source:string|null,_certified=false,_version=1):{source:string|null;document:null} {
 return {source,document:null};
}
export async function artifactQuery<T=Record<string,unknown>>(db:Queryable,sql:string,params:unknown[]=[]):Promise<{rows:T[]}> {
 return db.query<T>(sql,params);
}
export async function loadArtifactDocument<T>(db:Queryable,sql:string,params:unknown[]):Promise<T|null> {
 return (await artifactQuery<T>(db,sql,params)).rows[0]??null;
}
