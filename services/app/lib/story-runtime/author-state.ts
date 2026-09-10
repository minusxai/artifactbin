import type {DataflowState} from '@/lib/story/dataflow';

export type AuthorStateDelta = {
  [Field in 'values' | 'tables' | 'errors' | 'mutationAccess']?: Record<string, NonNullable<DataflowState[Field]>[string] | undefined>;
};

/** Select changed fields by identity; undefined tombstones remove own keys.
 * Optional projection is for named consumers. The host sends all deltas so
 * synchronous getters stay current, while the child filters listener payloads.
 * Only viewer-visible mutation capabilities are included; account identity stays in the host.
 */
export function authorStateDelta(previous: DataflowState | null, next: DataflowState, names?: {values: readonly string[]; tables: readonly string[]}): AuthorStateDelta | null {
  const result: AuthorStateDelta = {};
  for (const field of ['values','tables','errors','mutationAccess'] as const) {
    if(names && field==='mutationAccess') continue;
    const before=previous?.[field], after=next[field] ?? {};
    if(before===after) continue;
    const keys=names ? names[field==='values'?'values':'tables'] : new Set([...Object.keys(before??{}),...Object.keys(after)]);
    const entries=[...keys].filter(key=>{
      const had=!!before&&Object.hasOwn(before,key), has=Object.hasOwn(after,key);
      return had!==has || (has && (!had || !Object.is(before![key],after[key])));
    }).map(key=>[key,Object.hasOwn(after,key)?after[key]:undefined]);
    if(entries.length) Object.assign(result,{[field]:Object.fromEntries(entries)});
  }
  return Object.keys(result).length?result:null;
}
