/** Document-scoped opt-in; ordinary pages and all other comment surfaces remain legacy. */
import { createContext } from 'solid-js';
export const TiptapComments=createContext<()=>boolean>(()=>false);
export function isTiptapDocument(html:string):boolean {
 return !!new DOMParser().parseFromString(html,'text/html').querySelector('[data-af-editable="rich-native-v1"]');
}
