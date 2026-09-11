import {parseJsx,type JsxElement} from '../../app/lib/jsx';
import {CliError} from './errors';
import type {Snapshot} from './workspace';

/** The dataset's local source: rows for one stored table, a `<Dataset>` definition for everything else. */
export function flatDataset(snapshot:Snapshot):boolean{
 const catalog=(snapshot.meta as {catalog?:{kind?:string;tables?:Array<{objectKey?:string}>}}|undefined)?.catalog;
 if(!catalog)return true;
 return catalog.kind==='stored'&&(catalog.tables?.length??0)<=1&&!!catalog.tables?.[0]?.objectKey;
}
export const endLine=(text:string):string=>text.endsWith('\n')?text:text+'\n';
export function datasetRows(bytes:Buffer):Record<string,unknown>[]{
 let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_response','Dataset content must be JSON rows.');}
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new CliError('invalid_response','Dataset content must contain row objects.');
 return rows as Record<string,unknown>[];
}

export interface DefinitionConnection {target:{host:string;port:number;database:string;username:string;ssl:boolean};secretId?:string;span:{start:number;end:number}}
function definitionRoot(source:string):JsxElement{
 const parsed=parseJsx(source);
 if(!parsed.ok)throw new CliError('invalid_definition','The dataset definition is not valid JSX.','Run afbin validate on the definition file.');
 const roots=parsed.nodes.filter(node=>node.type!=='text'||node.value.trim());
 if(roots.length!==1||roots[0].type!=='element'||roots[0].tag!=='Dataset')throw new CliError('invalid_definition','A dataset definition holds exactly one <Dataset> root.');
 return roots[0];
}
/** Read the inline connection without requiring its secret id, so a first push can still bind one. */
export function datasetConnection(source:string):DefinitionConnection|undefined{
 const root=definitionRoot(source);
 const element=root.children.find((node):node is JsxElement=>node.type==='element'&&node.tag==='Connection');
 if(!element)return undefined;
 const read=(name:string)=>{const attribute=element.attributes.find(item=>item.name===name);if(attribute&&!attribute.value.static)throw new CliError('invalid_definition',`Connection.${name} must be a static value.`);return attribute?.value.static?attribute.value.json:undefined;};
 const text=(name:string)=>{const value=read(name);if(typeof value!=='string'||!value)throw new CliError('invalid_definition',`Connection.${name} must be a string.`);return value;};
 const port=read('port');if(typeof port!=='number'||!Number.isInteger(port))throw new CliError('invalid_definition','Connection.port must be an integer.');
 const ssl=read('ssl');if(typeof ssl!=='boolean')throw new CliError('invalid_definition','Connection.ssl must be true or false.');
 const secret=read('passwordSecretId');
 if(secret!==undefined&&typeof secret!=='string')throw new CliError('invalid_definition','Connection.passwordSecretId must be a string.');
 const existing=element.attributes.find(item=>item.name==='passwordSecretId');
 const last=element.attributes[element.attributes.length-1];
 const span=existing?{start:existing.start,end:existing.end}:{start:last?last.end:element.start+'<Connection'.length,end:last?last.end:element.start+'<Connection'.length};
 return {target:{host:text('host'),port,database:text('database'),username:text('username'),ssl},...(secret===undefined?{}:{secretId:secret}),span};
}
/** Reference the bound secret by id; the password itself never reaches this file. */
export function withSecretId(source:string,connection:DefinitionConnection,secretId:string):string{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(secretId))throw new CliError('invalid_response','The server returned an unusable secret id.');
 const attribute=`passwordSecretId="${secretId}"`;
 return source.slice(0,connection.span.start)+(connection.span.start===connection.span.end?' ':'')+attribute+source.slice(connection.span.end);
}
