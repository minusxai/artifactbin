/** Canonical document -> existing static JSX. No MDX parser, storage, or executable compilation. */
import type {DocumentInline,DocumentJson,RichDocument} from '@artifactbin/contracts';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import {validateMarkupStructure} from '../story/local-validation';
import type {JsxElement,JsxNode} from '../jsx/types';
import {DocumentError} from './model';
export function parseDocumentJsx(source:string):JsxNode[]{const parsed=parseJsx(source);if(!parsed.ok)throw new DocumentError(parsed.error);return parsed.nodes;}
export function documentElement(tag:string,props:Record<string,DocumentJson>,children:JsxNode[]=[]):JsxElement{return {type:'element',tag,isComponent:/^[A-Z]/.test(tag),attributes:Object.entries(props).map(([name,json])=>({name,value:{static:true as const,json},start:0,end:0})),children,selfClosing:children.length===0,start:0,end:0};}
const textNode=(value:string):JsxNode=>({type:'text',value,start:0,end:0});
function nodeJsx(d:RichDocument,id:string):JsxNode[]{
 const n=d.nodes[id]!;
 const contents=()=>n.content?inlineJsx(d,n.content):(n.children??[]).flatMap(child=>nodeJsx(d,child));
 if(n.type==='document')return contents();
 if(n.type==='expression')return parseDocumentJsx(`{${n.text??''}}`);
 if(n.type==='code')return [documentElement('pre',n.props,[documentElement('code',{},[textNode(n.text??'')])])];
 const tag=n.type==='component'?n.name!:n.type==='html'?n.tag!:({paragraph:'p',heading:`h${n.props.depth}`,blockquote:'blockquote',list:n.props.ordered?'ol':'ul',listItem:'li',thematicBreak:'hr',table:'table',tableRow:'tr',tableCell:'td'} as Record<string,string>)[n.type];
 if(!tag)throw new DocumentError(`Cannot render ${n.type}`);
 const props={...n.props,...(n.name==='Helmet'?{}:{id})};
 const el=documentElement(tag,props,n.name==='Iframe'||n.name==='Helmet'?parseDocumentJsx(n.text??''):contents());
 for(const [name,binding] of Object.entries(n.bindings??{})){
  const bindingNode=parseDocumentJsx(`<${tag} ${name}={${binding.source}} />`)[0] as JsxElement;el.attributes.push(...bindingNode.attributes);
 }
 return [el];
}
function inlineJsx(d:RichDocument,items:DocumentInline[]):JsxNode[]{return items.flatMap(item=>{
 if(item.type==='break')return [documentElement('br',{})];if(item.type==='nodeRef')return nodeJsx(d,item.nodeId);
 let node:JsxNode=textNode(item.text);
 for(const mark of [...item.marks].reverse())node=documentElement(({strong:'strong',emphasis:'em',strike:'s',code:'code',link:'a',span:'span',underline:'u',sup:'sup',sub:'sub'} as Record<string,string>)[mark.type]!,mark.attrs??{},[node]);
 return [node];
});}
export function documentJsx(d:RichDocument):string{return serializeJsx(nodeJsx(d,d.rootId));}
export function validateDocumentMarkup(d:RichDocument):void {
 const {errors}=validateMarkupStructure(documentJsx(d));
 if(errors.length)throw new DocumentError(errors.map(e=>e.message).join('\n'));
}
