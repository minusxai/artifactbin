/** Pure authoring checks shared by server preparation and the bundled CLI. */
import {parseJsx,validateJsx,type ValidationError,type JsxNode} from '@/lib/jsx';
import {syntaxErrorDetail} from '@/lib/jsx/syntax-error';
import {JSX_STORY_COMPONENT_NAMES} from '@/lib/jsx/components';
import {STORY_HTML_TAGS} from '@/lib/jsx/component-names';
import {dataflowOf,splitHelmet,validateHelmet,type HelmetSplit} from './helmet';
import {analyzeRowScopes} from '@/lib/jsx/row-scope';
import {collectRefNameUses,validateDataflow} from '../data/dataflow';
import {findBrokenEmbeds} from '../data/refs';
import {cspExtensionsOf} from './csp-extensions';

export interface MarkupStructureOptions{
 /** The components the document's script exports (the server builds the script first); absent, any unknown capitalized tag passes when a script exists. */
 scriptComponents?:ReadonlySet<string>;
}
export function validateMarkupStructure(source:string,options:MarkupStructureOptions={}):{errors:ValidationError[];split?:HelmetSplit}{
 const parsed=parseJsx(source);
 if(!parsed.ok)return{errors:[syntaxErrorDetail(source,parsed)]};
 const split=splitHelmet(parsed.nodes);
 const helmetErrors=validateHelmet(parsed.nodes);
 const csp=cspExtensionsOf(split.content,split.helmet);
 return{split,errors:[
  ...localPathErrors(parsed.nodes),
  ...helmetErrors,
  ...(csp.ok?[]:csp.errors),
  ...analyzeRowScopes(split.body,split.content.queries.length ? undefined : Object.fromEntries(split.content.values.flatMap(value=>value.kind==='table'?[[value.name,value.columns]]:[]))).errors.map(message=>({message})),
  ...validateJsx(split.body,{components:JSX_STORY_COMPONENT_NAMES,allowedHtmlTags:STORY_HTML_TAGS,stylePolicy:'allow',
   scriptComponents:options.scriptComponents??(split.content.script?'any':undefined)}),
  ...findBrokenEmbeds(source),
  ...(helmetErrors.length?[]:validateDataflow(dataflowOf(split.content),collectRefNameUses(split.body))),
 ]};
}

/** Artifact source uses durable IDs; command arguments may still name local files. */
function localPathErrors(nodes:JsxNode[]):ValidationError[]{
 const errors:ValidationError[]=[];
 for(const node of nodes){
  if(node.type!=='element')continue;
  for(const attr of node.attributes){
   if(!['href','src','source','poster','srcSet','srcset'].includes(attr.name)||!attr.value.static||typeof attr.value.json!=='string')continue;
   const values=attr.name.toLowerCase()==='srcset'?attr.value.json.split(',').map(item=>item.trim().split(/\s+/)[0]??''):[attr.value.json];
   for(const value of values)if(value&&!value.startsWith('#')&&!value.startsWith('$')&&!value.startsWith('/')&&!/^[a-z][a-z0-9+.-]*:/i.test(value))errors.push({message:attr.name==='href'?'Local file references are not supported. Run afbin add --json and use /a/ID for document navigation links.':'Local file references are not supported. Run afbin add --json and use ref:ID for dataset and media references.',start:attr.start,end:attr.end});
  }
  errors.push(...localPathErrors(node.children));
 }
 return errors;
}
