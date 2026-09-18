import {likers} from '@/lib/relations';
import {parseDatasetDefinition,serializeDatasetDefinition} from './definition';
import type {DatasetColumn, PersonCard, Queryable, Row, UserOption} from '@artifactbin/contracts';
import {avatarUrl} from '@/lib/avatars';
import {DatasetError} from './errors';

/** Membership is explicit sharing plus ownership, never public-link readership. */
async function memberIds(db:Queryable, refs:string[],lock=false):Promise<string[]> {
 const ids=refs.filter(ref=>ref.startsWith('ref:')).map(ref=>ref.slice(4));
 const likeIds=refs.filter(ref=>ref.startsWith('likes:')).map(ref=>ref.slice(6));
 const liked:string[]=[];
 if(lock){const scopes=[...new Set([...ids,...likeIds])].sort();if(scopes.length)await db.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE',[scopes]);}
 for(const id of likeIds)liked.push(...await likers(db,id));
 if(!ids.length)return [...new Set(liked)];
 const result=await db.query<{id:string}>(`SELECT DISTINCT u.id FROM users u JOIN artifacts a ON
   (a.user_id=u.id OR EXISTS (SELECT 1 FROM artifact_shares s WHERE s.artifact_id=a.id AND (s.user_id=u.id OR (s.user_id IS NULL AND s.email=u.email))))
   WHERE a.id=ANY($1::text[]) AND a.deleted_at IS NULL`,[ids]);
 return [...new Set([...liked,...result.rows.map(row=>row.id)])];
}

/** Check actual assigned fields at the transaction boundary. Null is an unset user. */
export async function validateUserWrites(db:Queryable, columns:DatasetColumn[], rows:Row[], userId:string|null):Promise<void> {
 for(const column of columns.filter(c=>c.type==='user')) {
  const values=[...new Set(rows.filter(row=>Object.hasOwn(row,column.name)).map(row=>row[column.name]).filter(value=>value!=null))];
  if(!values.length)continue;
  if(values.some(value=>typeof value!=='string'))throw new DatasetError(`User field ${column.name} requires a user ID`,403);
  if(column.constraints?.self && (!userId || values.some(value=>value!==userId)))throw new DatasetError(`User field ${column.name} must be the logged-in user`,403);
  const valid=new Set((await db.query<{id:string}>('SELECT id FROM users WHERE id=ANY($1::text[])',[values])).rows.map(row=>row.id));
  if(values.some(value=>!valid.has(value as string)))throw new DatasetError(`User field ${column.name} contains an unknown user`,403);
  if(column.constraints?.memberOf?.some(ref=>ref==='current'||ref==='_likes'))throw new DatasetError(`User field ${column.name} must remain unset until its report is attached`,403);
  if(column.constraints?.memberOf) {
   const allowed=new Set(await memberIds(db,column.constraints.memberOf,true));
   if(values.some(value=>!allowed.has(value as string)))throw new DatasetError(`User field ${column.name} requires membership in one of its documents`,403);
  }
 }
}

/** No unrestricted user directory. Only constrained members or the authenticated user. */
export async function userOptions(db:Queryable,column:DatasetColumn,userId:string|null):Promise<UserOption[]> {
 const c=column.constraints;
 let ids=c?.memberOf?await memberIds(db,c.memberOf):[];
 if(c?.self)ids=userId&&(!c.memberOf||ids.includes(userId))?[userId]:[];
 if(!ids.length)return [];
 const result=await db.query<{id:string;name:string|null;username:string|null}>('SELECT id,name,username FROM users WHERE id=ANY($1::text[]) ORDER BY COALESCE(name,username,id),id',[ids]);
 return result.rows.map(user=>({value:user.id,label:user.name||user.username||user.id}));
}

/** Whole-table import/replace uses the same constraints as SQL assignments. */
export async function validateUserContent(db:Queryable, input:{meta:Record<string,unknown>}, userId:string|null, load:(key:string)=>Promise<Row[]>):Promise<void> {
 const catalog=input.meta.catalog as {tables:Array<{columns:DatasetColumn[];objectKey?:string}>}|undefined;
 for(const table of catalog?.tables??[]) {
  if(table.objectKey&&table.columns.some(c=>c.type==='user'))await validateUserWrites(db,table.columns,await load(table.objectKey),userId);
 }
}

/**
 * THE PEOPLE A DOCUMENT MAY NAME, as cards rather than labels.
 *
 * One lookup, for ids the server ALREADY put in front of this viewer (their own
 * id, the ids in a queried table) — never a directory, never an email. A card
 * is the whole of what a document learns about a person: the display name under
 * today's rule, the public handle when they chose one, and the ADDRESS of their
 * picture, which only lib/avatars may compute (the stored key never leaves the
 * server). An id nobody has is simply absent, and the client draws
 * "Unknown person" for it.
 */
export async function people(db:Queryable,ids:string[]):Promise<Record<string,PersonCard>> {
 if(!ids.length)return {};
 const rows=(await db.query<{id:string;name:string|null;username:string|null;image_key:string|null}>('SELECT id,name,username,image_key FROM users WHERE id=ANY($1::text[])',[ids])).rows;
 return Object.fromEntries(rows.map(u=>[u.id,{name:u.name||u.username||u.id,handle:u.username,image:avatarUrl(u)}]));
}

/** Resolve shorthand consistently in both the executable catalog and authored source. */
export function resolveUserColumnScope(columns:DatasetColumn[],scope:string):DatasetColumn[] {
 return columns.map(c=>c.constraints?.memberOf?.some(ref=>ref==='current'||ref==='_likes')?{...c,constraints:{...c.constraints,memberOf:[...new Set(c.constraints.memberOf.map(ref=>ref==='current'?`ref:${scope}`:ref==='_likes'?`likes:${scope}`:ref))]}}:c);
}

/** A schema round-trip must not turn a frozen current scope back into a wildcard. */
export function retainUserScope<T extends {meta:Record<string,unknown>;source?:string|null}>(input:T,previous:{meta:Record<string,unknown>}):T {
 const scope=previous.meta.userScopeDocument;
 if(typeof scope!=='string')return input;
 const resolve=(columns:DatasetColumn[])=>resolveUserColumnScope(columns,scope);
 const catalog=input.meta.catalog as {tables:Array<{columns:DatasetColumn[]}>}|undefined;
 let source=input.source;
 if(catalog&&source?.trimStart().startsWith('<Dataset')) {
  const definition=parseDatasetDefinition(source);
  source=serializeDatasetDefinition({...definition,tables:definition.tables.map(t=>({...t,columns:t.columns?.map(c=>typeof c==='string'?c:resolve([c])[0]!)}))});
 }
 return {...input,...(source!==undefined?{source}:{}),meta:{...input.meta,userScopeDocument:scope,...(Array.isArray(input.meta.columns)?{columns:resolve(input.meta.columns as DatasetColumn[])}:{}),...(catalog?{catalog:{...catalog,tables:catalog.tables.map(t=>({...t,columns:resolve(t.columns)}))}}:{})}};
}

/** A copied dataset's page-relative membership belongs to the new page. */
export function remapLikesScope<T extends {meta:Record<string,unknown>;source:string|null}>(input:T,from:string,to:string):T{
 const columns=(items:DatasetColumn[])=>items.map(column=>column.constraints?.memberOf?{...column,constraints:{...column.constraints,memberOf:column.constraints.memberOf.map(ref=>ref===`likes:${from}`?`likes:${to}`:ref)}}:column);
 const catalog=input.meta.catalog as {tables:Array<{columns:DatasetColumn[]}>}|undefined;
 return {...input,source:input.source?.replaceAll(`likes:${from}`,`likes:${to}`)??null,meta:{...input.meta,
  ...(input.meta.userScopeDocument===from?{userScopeDocument:to}:{}),
  ...(Array.isArray(input.meta.columns)?{columns:columns(input.meta.columns)}:{}),
  ...(catalog?{catalog:{...catalog,tables:catalog.tables.map(table=>({...table,columns:columns(table.columns)}))}}:{}),
 }};
}
