import {nativeDigest} from './selection.ts';
import type {NativeComponentHelperIdentity,NativeComponentRecipe} from './component-presentation-contracts.ts';
/** Stable native structural identities are distinct from the source annotation projection. */
export function nativeComponentHelperIdentity(afId:string):NativeComponentHelperIdentity {
 return {trigger:'h_'+nativeDigest({afId,role:'mutation-hint-trigger'}),contents:'h_'+nativeDigest({afId,role:'mutation-hint-contents'})};
}
export function nativeComponentHelperIds(sourceNode:string,afId:string,recipes:readonly NativeComponentRecipe[]=[]):string[] {
 const matching=recipes.filter(recipe=>recipe.sourceNode===sourceNode&&recipe.actionWrapper==='mutation-hint');
 if(!matching.length)return [];
 if(matching.length!==1||matching[0]!.tag!=='Button')throw Error('Ambiguous structural component identity');
 return Object.values(nativeComponentHelperIdentity(afId));
}
