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
const boolean=(value:JsonValue|undefined,name:string)=>{if(typeof value!=='boolean')throw new Error(`Dataset definition: ${name} must be boolean`);return value;};
const strings=(value:JsonValue|undefined,name:string)=>{if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw new Error(`Dataset definition: ${name} must be string[]`);return value as string[];};
const quote=(value:string)=>`"${value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"`;
const prop=(name:string,value:unknown)=>typeof value==='string'?`${name}=${quote(value)}`:`${name}={${JSON.stringify(value)}}`;

/** Static markup, never evaluated. The visual editor and API share this codec. */
export function parseDatasetDefinition(source: string): CatalogInput {
 const parsed=parseJsx(source);if(!parsed.ok)throw new Error(`Dataset definition: ${parsed.error}`);
 const roots=parsed.nodes.filter(node=>node.type!=='text'||node.value.trim());
 if(roots.length!==1||roots[0].type!=='element'||roots[0].tag!=='Dataset')throw new Error('Dataset definition: expected one Dataset root');
 const root=roots[0],a=attrs(root,['kind','defaultSchema','refreshSeconds']);textFree(root);
 const children=elements(root);if(children.some(child=>!['Connection','Notebook','Table'].includes(child.tag)))throw new Error('Dataset definition: unknown child');
 const connectionNode=children.find(child=>child.tag==='Connection');const notebookNode=children.find(child=>child.tag==='Notebook');
 if(children.filter(child=>child.tag==='Connection').length>1||children.filter(child=>child.tag==='Notebook').length>1)throw new Error('Dataset definition: duplicate section');
 const kind=string(a.kind,'kind');if(kind!=='postgres'&&kind!=='stored')throw new Error('Dataset definition: invalid kind');
 let connection:CatalogInput['connection'];
 if(connectionNode){textFree(connectionNode);const c=attrs(connectionNode,['host','port','database','username','ssl','passwordSecretId']);connection={host:string(c.host,'host'),port:number(c.port,'port'),database:string(c.database,'database'),username:string(c.username,'username'),ssl:boolean(c.ssl,'ssl'),passwordSecretId:string(c.passwordSecretId,'passwordSecretId')};}
 let notebook:CatalogInput['notebook'];
 if(notebookNode){attrs(notebookNode,[]);textFree(notebookNode);const cells=elements(notebookNode);if(cells.some(cell=>cell.tag!=='SqlCell'))throw new Error('Dataset definition: Notebook only accepts SqlCell');notebook={cells:cells.map(cell=>{textFree(cell);const c=attrs(cell,['id','name','sql']);return {id:string(c.id,'cell id'),name:string(c.name,'cell name'),sql:string(c.sql,'cell sql')};})};}
 const tables=children.filter(child=>child.tag==='Table').map(table=>{textFree(table);const t=attrs(table,['schema','name','sourceSchema','sourceTable','columns','modelCellId','rows','sql']);const base={schema:string(t.schema,'table schema'),name:string(t.name,'table name'),...(t.columns!==undefined?{columns:strings(t.columns,'table columns')}: {})};if(t.modelCellId!==undefined)return {...base,modelCellId:string(t.modelCellId,'modelCellId')};if(t.sourceSchema!==undefined||t.sourceTable!==undefined)return {...base,source:{schema:string(t.sourceSchema,'sourceSchema'),table:string(t.sourceTable,'sourceTable')}};if(t.rows!==undefined){if(!Array.isArray(t.rows)||t.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Dataset definition: rows must be objects');return {...base,rows:t.rows as Record<string,JsonValue>[]};}if(t.sql!==undefined)return {...base,sql:string(t.sql,'table sql')};return base;});
 return {kind,...(a.defaultSchema!==undefined?{defaultSchema:string(a.defaultSchema,'defaultSchema')} : {}),...(a.refreshSeconds!==undefined?{refreshSeconds:number(a.refreshSeconds,'refreshSeconds')} : {}),...(connection?{connection}:{}),...(notebook?{notebook}:{}),tables};
}
export function serializeDatasetDefinition(definition: CatalogInput): string {
 const root=[prop('kind',definition.kind),...(definition.defaultSchema!==undefined?[prop('defaultSchema',definition.defaultSchema)]:[]),...(definition.refreshSeconds!==undefined?[prop('refreshSeconds',definition.refreshSeconds)]:[])].join(' ');
 const connection=definition.connection?`  <Connection ${[prop('host',definition.connection.host),prop('port',definition.connection.port),prop('database',definition.connection.database),prop('username',definition.connection.username),prop('ssl',definition.connection.ssl),prop('passwordSecretId',definition.connection.passwordSecretId)].join(' ')} />`:'';
 const notebook=definition.notebook?[`  <Notebook>`,...definition.notebook.cells.map(cell=>`    <SqlCell ${prop('id',cell.id)} ${prop('name',cell.name)} ${prop('sql',cell.sql)} />`),`  </Notebook>`].join('\n'):'';
 const tables=definition.tables.map(table=>`  <Table ${[prop('schema',table.schema),prop('name',table.name),...(table.source?[prop('sourceSchema',table.source.schema),prop('sourceTable',table.source.table)]:[]),...(table.modelCellId?[prop('modelCellId',table.modelCellId)]:[]),...(table.rows?[prop('rows',table.rows)]:[]),...(table.sql?[prop('sql',table.sql)]:[]),...(table.columns!==undefined?[prop('columns',table.columns)]:[])].join(' ')} />`);
 return [`<Dataset ${root}>`,connection,notebook,...tables,`</Dataset>`].filter(Boolean).join('\n');
}
