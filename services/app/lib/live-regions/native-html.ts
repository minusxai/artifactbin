/** Strict nested HTML codec for the opt-in native format; never accepts executable attributes. */
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from 'prosemirror-model';
import { nativeSchema } from './native-schema';
import { LiveRegionRefusal } from './refusal';
import { safeHref, isNodeId } from './schema';
const tags: Record<string,string> = { p:'paragraph', ul:'bulletList', ol:'orderedList', li:'listItem', blockquote:'blockquote', pre:'codeBlock', hr:'horizontalRule', br:'hardBreak' };
const marks: Record<string,string> = { strong:'bold', b:'bold', em:'italic', i:'italic', code:'code', a:'link' };
const refuse = (detail:string):never => { throw new LiveRegionRefusal('unsupported_content',[detail]); };
type HtmlNode = DefaultTreeAdapterMap['childNode'];
export function readNativeHtml(html:string):PMNode {
  const walk = (nodes:HtmlNode[], inherited:NonNullable<JSONContent['marks']> = [], code=false):JSONContent[] => nodes.flatMap(node => {
    if(node.nodeName==='#text') { const text=(node as DefaultTreeAdapterMap['textNode']).value;return text ? [{type:'text',text,marks:inherited}] : []; }
    if(!('tagName' in node)) return refuse('non-element native content');
    const attrs=Object.fromEntries(node.attrs.map(a=>[a.name,a.value]));
    const allowed=new Set(['data-af-id',...(node.tagName==='a'?['href','rel','target','title']:node.tagName==='ol'?['start']:node.tagName==='ul'?['data-type']:node.tagName==='li'?['data-type','data-checked']:node.tagName==='code'?['class']:[])]);
    for(const key of Object.keys(attrs))if(!allowed.has(key))refuse(`attribute ${key}`);
    if(attrs.target && attrs.target!=='_blank')refuse('link target');
    if(attrs.rel && attrs.rel!=='noopener noreferrer nofollow' && attrs.rel!=='noopener noreferrer')refuse('link rel');
    if(attrs['data-type'] && attrs['data-type']!==(node.tagName==='ul'?'taskList':'taskItem'))refuse('task type');
    if(attrs['data-af-id'] && !isNodeId(attrs['data-af-id'])) refuse('invalid identity');
    if(attrs.class && !(node.tagName==='code' && /^language-[\w+-]+$/.test(attrs.class))) refuse('class');
    if(node.tagName==='code' && code) return walk(node.childNodes,[],true);
    const mark=marks[node.tagName];
    if(mark) { if(mark==='link' && safeHref(attrs.href??'')!==attrs.href) refuse('unsafe link');return walk(node.childNodes,[...inherited,{type:mark,...(mark==='link'?{attrs:{href:attrs.href,title:attrs.title??null,target:null,rel:'noopener noreferrer nofollow',class:null}}:{})}],code); }
    let type=/^h[1-6]$/.test(node.tagName)?'heading':tags[node.tagName];
    if(node.tagName==='ul' && attrs['data-type']==='taskList')type='taskList';
    if(node.tagName==='li' && attrs['data-type']==='taskItem')type='taskItem';
    if(!type)return refuse(`node ${node.tagName}`);
    const own:Record<string,unknown>={afId:attrs['data-af-id']??null};
    if(type==='codeBlock'){const child=node.childNodes.find(n=>'tagName' in n&&n.tagName==='code');if(child&&'attrs' in child){const cls=child.attrs.find(a=>a.name==='class')?.value;if(cls)own.language=cls.replace(/^language-/, '');}}
    if(type==='heading')own.level=Number(node.tagName[1]);
    if(type==='orderedList'){own.start=Number(attrs.start??1);if(!Number.isSafeInteger(own.start)||Number(own.start)<1)refuse('list start');}
    if(type==='taskItem'){if(!['true','false'].includes(attrs['data-checked']??''))refuse('task checked');own.checked=attrs['data-checked']==='true';}
    const children=walk(node.childNodes,[],type==='codeBlock');
    return [{type,attrs:own,content:children.filter(child=>!(child.type==='text' && /^\s*$/.test(child.text??'') && !['paragraph','heading','codeBlock'].includes(type)))}];
  });
  try {const doc=nativeSchema.nodeFromJSON({type:'doc',content:walk(parseFragment(html).childNodes)});doc.check();return doc;}catch(error){if(error instanceof LiveRegionRefusal)throw error;return refuse('invalid native structure');}
}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function writeNativeHtml(doc:PMNode):string {
  const render=(node:PMNode):string=>{
    if(node.isText){let text=escape(node.text!);for(const mark of [...node.marks].reverse()){const tag=({bold:'strong',italic:'em',code:'code',link:'a'} as Record<string,string>)[mark.type.name];if(!tag)refuse('mark');text=`<${tag}${tag==='a'?` href="${escape(mark.attrs.href)}"${mark.attrs.title?` title="${escape(mark.attrs.title)}"`: ''}`:''}>${text}</${tag}>`;}return text;}
    let inner='';node.forEach(child=>{inner+=render(child);});if(node.type.name==='doc')return inner;
    const tag=({paragraph:'p',heading:`h${node.attrs.level}`,bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',taskItem:'li',blockquote:'blockquote',codeBlock:'pre',horizontalRule:'hr',hardBreak:'br'} as Record<string,string>)[node.type.name];
    if(!tag)return refuse('node');
    let attrs=node.attrs.afId?` data-af-id="${escape(node.attrs.afId)}"`:'';
    if(node.type.name==='orderedList'&&node.attrs.start!==1)attrs+=` start="${node.attrs.start}"`;
    if(node.type.name==='taskList')attrs+=' data-type="taskList"';
    if(node.type.name==='taskItem')attrs+=` data-type="taskItem" data-checked="${node.attrs.checked}"`;
    if(tag==='pre')inner=`<code${node.attrs.language?` class="language-${escape(node.attrs.language)}"`: ''}>${inner}</code>`;
    return `<${tag}${attrs}>`+(['br','hr'].includes(tag)?'':`${inner}</${tag}>`);
  };return render(doc);
}
