/** CommonMark input mapped to the native schema, preserving real nested list structure. */
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer, schema as baseMarkdownSchema } from 'prosemirror-markdown';
import { Schema, type Node as PMNode } from 'prosemirror-model';
import type { JSONContent } from '@tiptap/core';
import { safeHref } from './href';
const names:Record<string,string>={code_block:'codeBlock',bullet_list:'bulletList',ordered_list:'orderedList',list_item:'listItem',horizontal_rule:'horizontalRule',hard_break:'hardBreak'};
export function nativeMarkdownJson(source:string):JSONContent {
 const convert=(node:PMNode):JSONContent=>{
  if(node.type.name==='image')return {type:'text',text:`![${node.attrs.alt??''}](${node.attrs.src??''})`};
  const content:JSONContent[]=[];node.forEach(child=>{
   const converted=convert(child);
   if(converted.type==='bulletList'&&converted.content?.some(item=>item.type==='taskItem')){
    let group:JSONContent|undefined;
    for(const item of converted.content){const type=item.type==='taskItem'?'taskList':'bulletList';if(group?.type!==type){group={type,content:[]};content.push(group);}group.content!.push(item);}
   }else content.push(converted);
  });
  const result:JSONContent = {type:names[node.type.name]??node.type.name,...(node.isText?{text:node.text}:{}),
   attrs:node.type.name==='ordered_list'?{start:node.attrs.order}:node.type.name==='code_block'?{language:node.attrs.params||null}:node.type.name==='heading'?{level:node.attrs.level}:{},
   marks:node.marks.filter(mark=>mark.type.name!=='link'||safeHref(mark.attrs.href)===mark.attrs.href).map(mark=>({type:mark.type.name==='strong'?'bold':mark.type.name==='em'?'italic':mark.type.name,...(mark.type.name==='link'?{attrs:{href:mark.attrs.href}}:{})})),
   ...(content.length?{content}:{}),
  };
  if(result.type==='listItem'){
   const text=content[0]?.content?.[0];const match=text?.type==='text'&&/^\[([ xX])\] /.exec(text.text??'');
   if(match){result.type='taskItem';result.attrs={checked:match[1]!.toLowerCase()==='x'};text!.text=text!.text!.slice(match[0].length);if(!text!.text)content[0]!.content!.shift();}
  }
  if(result.type==='bulletList'&&content.every(child=>child.type==='taskItem'))result.type='taskList';
  else if(result.type==='orderedList')for(const child of content){if(child.type==='taskItem'){const marker=child.attrs?.checked?'[x] ':'[ ] ';child.type='listItem';child.attrs={};child.content![0]!.content!.unshift({type:'text',text:marker});}}
  return result;
 };return convert(defaultMarkdownParser.parse(source));
}
export function writeNativeMarkdown(doc:PMNode):string {
 const markdownSchema=new Schema({nodes:baseMarkdownSchema.spec.nodes.update('list_item',{...baseMarkdownSchema.nodes.list_item!.spec,attrs:{checked:{default:null}}}),marks:baseMarkdownSchema.spec.marks});
const serializer=new MarkdownSerializer({...defaultMarkdownSerializer.nodes,text(state,node,parent,index){const value=node.text!;const spaces=index===0&&parent.type.name!=='code_block'?/^ +/.exec(value)?.[0].length??0:0;if(spaces)state.write('&#32;'.repeat(spaces));state.text(value.slice(spaces));},list_item(state,node){if(typeof node.attrs.checked==='boolean')state.write(node.attrs.checked?'[x] ':'[ ] ');state.renderContent(node);}},defaultMarkdownSerializer.marks);

 const reverse=Object.fromEntries(Object.entries(names).map(([a,b])=>[b,a]));
 const convert=(node:PMNode):PMNode=>{
  if(node.isText)return markdownSchema.text(node.text!,node.marks.map(mark=>markdownSchema.marks[mark.type.name==='bold'?'strong':mark.type.name==='italic'?'em':mark.type.name]!.create(mark.type.name==='link'?{href:mark.attrs.href}:{})));
  const content:PMNode[]=[];node.forEach(child=>content.push(convert(child)));
  const name=node.type.name==='taskList'?'bullet_list':node.type.name==='taskItem'?'list_item':reverse[node.type.name]??node.type.name;
  return markdownSchema.nodes[name]!.create(name==='ordered_list'?{order:node.attrs.start}:name==='code_block'?{params:node.attrs.language??''}:node.type.name==='taskItem'?{checked:node.attrs.checked}:node.attrs,content);
 };return serializer.serialize(convert(doc));
}
