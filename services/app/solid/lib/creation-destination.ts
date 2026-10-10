import type { ArtifactDestination } from '@artifactbin/contracts';
/** Creation links retain the chosen workspace across the editor route. Authority stays server-side. */
export function creationDestination(search:string):ArtifactDestination|undefined {
 const params=new URLSearchParams(search),id=params.get('group_id');
 return id?{type:'group',id}:params.get('personal')==='1'?{type:'personal'}:undefined;
}
