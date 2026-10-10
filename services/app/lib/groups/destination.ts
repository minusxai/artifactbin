import type {ArtifactDestination,NewArtifactDestinationContext} from '@artifactbin/contracts';
/** Pure ordering only. Callers must authorize the selected owner and refuse inaccessible defaults. */
export function selectNewArtifactDestination(context:NewArtifactDestinationContext):ArtifactDestination {
 const {explicit,parent,preference,deployment_default}=context;
 if(explicit&&parent&&(explicit.type!==parent.type||(explicit.type==='group'&&parent.type==='group'&&explicit.id!==parent.id)))throw new Error('Explicit destination conflicts with parent owner');
 return explicit??parent??(preference&&preference.type!=='inherit'?preference:undefined)??deployment_default??{type:'personal'};
}
