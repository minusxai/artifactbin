/** Strict migration proof: no normalization of identities, attributes or structural whitespace is permitted. */
import {parseFragment,type DefaultTreeAdapterMap} from 'parse5';
import {attribute,parseSource,applyEdits} from '../html-page/html-source';
import {createNativeState,nativeHtml} from './native-state';
import {LiveRegionRefusal} from './refusal';
type Child=DefaultTreeAdapterMap['childNode'];
const manifest=(nodes:Child[]):unknown=>nodes.map(node=>{
 if(node.nodeName==='#text')return ['text',(node as DefaultTreeAdapterMap['textNode']).value];
 if(!('tagName' in node))throw new LiveRegionRefusal('unsupported_content',['migration structure']);
 return [node.tagName,node.attrs.map(a=>[a.name,a.value]).sort(),manifest(node.childNodes)];
});
export function convertLegacyPage(source:string){
 const edits:{start:number;end:number;text:string}[]=[];
 const states:{id:string;state:Uint8Array;snapshot:Uint8Array}[]=[];
 for(const element of parseSource(source).elements){
  const kind=attribute(element,'data-af-editable');
  if(kind!=='rich'&&kind!=='text')continue;
  const location=element.sourceCodeLocation,id=attribute(element,'data-af-id');
  if(kind==='text'||!id||!location?.startTag||!location.endTag)throw new LiveRegionRefusal('unsupported_content',['migration region']);
  const inner=source.slice(location.startTag.endOffset,location.endTag.startOffset);
  const native=createNativeState(inner);
  if(JSON.stringify(manifest(parseFragment(inner).childNodes))!==JSON.stringify(manifest(parseFragment(nativeHtml(native.state)).childNodes)))throw new LiveRegionRefusal('unsupported_content',['migration preservation']);
  const attr=location.attrs?.['data-af-editable'];
  if(!attr)throw new LiveRegionRefusal('unsupported_content',['migration marker']);
  edits.push({start:attr.startOffset,end:attr.endOffset,text:'data-af-editable="rich-native-v1"'});
  states.push({id,...native});
 }
 return {html:applyEdits(source,edits),states};
}
