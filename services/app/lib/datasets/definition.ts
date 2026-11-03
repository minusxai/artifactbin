import { escapeHtml } from '@artifactbin/utils/escape';
import {parseDatasetColumn} from '@artifactbin/utils/shape';
import type { CatalogInput } from './types';
import {parseJsx,type JsxElement,type JsonValue} from '@/lib/jsx';

const attrs=(element:JsxElement,allowed:string[])=>{
 const out:Record<string,JsonValue>={};
 for(const attribute of element.attributes){
  if(!allowed.includes(attribute.name))throw new Error(`Dataset definition: ${element.tag} does not allow ${attribute.name}`);
  if(Object.hasOwn(out,attribute.name))throw new Error(`Dataset definition: duplicate ${element.tag}.${attribute.name}`);
  if(!attribute.value.static)throw new Error(`Dataset definition: ${element.tag}.${attribute.name} must be static`);
  out[attribute.name]=attribute.value.json;
 }
 return out;
};
const elements=(element:JsxElement)=>element.children.filter((node):node is JsxElement=>node.type==='element');
const textFree=(element:JsxElement)=>{if(element.children.some(node=>node.type!=='element'&&(node.type!=='text'||node.value.trim())))throw new Error(`Dataset definition: ${element.tag} only accepts elements`);};
const string=(value:JsonValue|undefined,name:string)=>{if(typeof value!=='string'||!value)throw new Error(`Dataset definition: ${name} must be a string`);return value;};
const number=(value:JsonValue|undefined,name:string)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Dataset definition: ${name} must be a number`);return value;};
const columns=(value:JsonValue|undefined)=>{if(!Array.isArray(value))throw new Error('Dataset definition: columns must be an array');return value.map(v=>typeof v==='string'?v:parseDatasetColumn(v));};
const quote=(value:string)=>`"${escapeHtml(value)}"`;
const prop=(name:string,value:unknown)=>typeof value==='string'?`${name}=${quote(value)}`:`${name}={${JSON.stringify(value)}}`;

/** Static markup, never evaluated. The visual editor and API share this codec. */
export function parseDatasetDefinition(source: string): CatalogInput {
 const parsed=parseJsx(source);if(!parsed.ok)throw new Error(`Dataset definition: ${parsed.error}`);
 const roots=parsed.nodes.filter(node=>node.type!=='text'||node.value.trim());
 if(roots.length!==1||roots[0].type!=='element'||roots[0].tag!=='Dataset')throw new Error('Dataset definition: expected one Dataset root');
 const root=roots[0],a=attrs(root,['kind','defaultSchema','refreshSeconds']);textFree(root);
 const children=elements(root);if(children.some(child=>child.tag!=='Table'))throw new Error('Dataset definition: unknown child');
 const kind=string(a.kind,'kind');if(kind!=='stored')throw new Error('Dataset definition: invalid kind');
 const tables=children.filter(child=>child.tag==='Table').map(table=>{textFree(table);const t=attrs(table,['schema','name','columns','rows','sql']);const base={schema:string(t.schema,'table schema'),name:string(t.name,'table name'),...(t.columns!==undefined?{columns:columns(t.columns)}: {})};if(t.rows!==undefined){if(!Array.isArray(t.rows)||t.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Dataset definition: rows must be objects');return {...base,rows:t.rows as Record<string,JsonValue>[]};}if(t.sql!==undefined)return {...base,sql:string(t.sql,'table sql')};return base;});
 return {kind,...(a.defaultSchema!==undefined?{defaultSchema:string(a.defaultSchema,'defaultSchema')} : {}),...(a.refreshSeconds!==undefined?{refreshSeconds:number(a.refreshSeconds,'refreshSeconds')} : {}),tables};
}
export function serializeDatasetDefinition(definition: CatalogInput): string {
 const root=[prop('kind',definition.kind),...(definition.defaultSchema!==undefined?[prop('defaultSchema',definition.defaultSchema)]:[]),...(definition.refreshSeconds!==undefined?[prop('refreshSeconds',definition.refreshSeconds)]:[])].join(' ');
 const tables=definition.tables.map(table=>`  <Table ${[prop('schema',table.schema),prop('name',table.name),...(table.rows?[prop('rows',table.rows)]:[]),...(table.sql?[prop('sql',table.sql)]:[]),...(table.columns!==undefined?[prop('columns',table.columns)]:[])].join(' ')} />`);
 return [`<Dataset ${root}>`,...tables,`</Dataset>`].join('\n');
}
