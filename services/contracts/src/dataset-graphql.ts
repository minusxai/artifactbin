import type { HtmlDatasetLink } from './html-page';
import type { PageMutationOutcome } from './page-operation';
export type DatasetCellType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
/** Stable IDs, never display labels, address rows and columns. Exactly one typed value (or null) per cell. */
export type DatasetCellValue = {type:'STRING';value:string|null}|{type:'NUMBER';value:number|null}|{type:'BOOLEAN';value:boolean|null}|{type:'JSON';value:import('./html-page').HtmlJson};
export interface DatasetColumnDescriptor { id:string; label:string; type:DatasetCellType; nullable:boolean }
export interface DatasetCell { columnId:string; value:DatasetCellValue }
export interface DatasetGraphqlRow { id:string; cells:readonly DatasetCell[] }
export type DatasetFilterOperator='EQ'|'NE'|'LT'|'LTE'|'GT'|'GTE'|'IS_NULL';
export interface DatasetRowFilter { columnId:string; operator:DatasetFilterOperator; value?:DatasetCellValue }
export interface DatasetReadRequest {
  tableId:string; columnIds?:readonly string[]; filters?:readonly DatasetRowFilter[];
  order?:readonly {columnId:string;direction:'ASC'|'DESC'}[]; first:number; after?:string;
}
export interface DatasetReadResult {
  revision:string; columns:readonly DatasetColumnDescriptor[]; rows:readonly DatasetGraphqlRow[];
  pageInfo:{hasNextPage:boolean;endCursor:string|null};
}
export type DatasetRowChange = {kind:'INSERT';cells:readonly DatasetCell[]}|{kind:'UPDATE';rowId:string;cells:readonly DatasetCell[]}|{kind:'DELETE';rowId:string};
export interface DatasetWriteRequest { tableId:string; expectedRevision:string; requestId:string; changes:readonly DatasetRowChange[] }
export interface DatasetWriteReceipt { requestId:string; revision:string|null; outcome:Exclude<PageMutationOutcome,'offline'>; rowIds:readonly string[] }
/** Implement with original dataset policies/grants; page readability is insufficient authorization. */
export interface DatasetGraphql<A> {
  read(actor:A,binding:HtmlDatasetLink,request:DatasetReadRequest,signal:AbortSignal):Promise<DatasetReadResult>;
  write(actor:A,binding:HtmlDatasetLink,request:DatasetWriteRequest,signal:AbortSignal):Promise<DatasetWriteReceipt>;
}
export const DATASET_GRAPHQL_MAX_PAGE=100;
export const DATASET_GRAPHQL_MAX_CHANGES=100;
/** Constant schema for every dataset. JSON payloads never replace stable column/row identities. */
export const DATASET_GRAPHQL_SDL = `
scalar JSON
scalar FiniteNumber
enum CellType { STRING NUMBER BOOLEAN JSON }
enum FilterOperator { EQ NE LT LTE GT GTE IS_NULL }
enum SortDirection { ASC DESC }
enum RowChangeKind { INSERT UPDATE DELETE }
enum WriteOutcome { committed rejected unknown }
type Column { id: ID! label: String! type: CellType! nullable: Boolean! }
type CellValue { type: CellType! string: String number: FiniteNumber boolean: Boolean json: JSON }
input CellValueInput { type: CellType! string: String number: FiniteNumber boolean: Boolean json: JSON }
type Cell { columnId: ID! value: CellValue! }
input CellInput { columnId: ID! value: CellValueInput! }
type Row { id: ID! cells: [Cell!]! }
input Filter { columnId: ID! operator: FilterOperator! value: CellValueInput }
input Order { columnId: ID! direction: SortDirection! }
type PageInfo { hasNextPage: Boolean! endCursor: String }
type Rows { revision: String! columns: [Column!]! rows: [Row!]! pageInfo: PageInfo! }
input RowChange { kind: RowChangeKind! rowId: ID cells: [CellInput!] }
type WriteReceipt { requestId: ID! revision: String outcome: WriteOutcome! rowIds: [ID!]! }
type Query { rows(tableId: ID!, columnIds: [ID!], filters: [Filter!], order: [Order!], first: Int! = 20, after: String): Rows! }
type Mutation { writeRows(tableId: ID!, expectedRevision: String!, requestId: ID!, changes: [RowChange!]!): WriteReceipt! }
`;
/** Pure preflight only. Runtime must still validate schema/IDs/cells and repeat policy inside its transaction. */
export function datasetRequestProblem(binding:HtmlDatasetLink,input:DatasetReadRequest|DatasetWriteRequest):string|null {
  if ('changes' in input) {
    if(binding.mode==='pinned')return 'pinned_dataset_readonly';
    if(!input.requestId || !input.expectedRevision)return 'write_identity_required';
    if(!input.changes.length || input.changes.length>DATASET_GRAPHQL_MAX_CHANGES)return 'invalid_changes';
  } else if (!Number.isInteger(input.first)||input.first<1||input.first>DATASET_GRAPHQL_MAX_PAGE)return 'invalid_page_size';
  return null;
}
/** GraphQL wire uses named fields because GraphQL has no scalar input union. Only the matching slot may be set. */
export interface DatasetCellWireValue { type:DatasetCellType; string?:string|null; number?:number|null; boolean?:boolean|null; json?:import('./html-page').HtmlJson }
export function datasetCellFromWire(input:DatasetCellWireValue):DatasetCellValue|null {
  const slot={STRING:'string',NUMBER:'number',BOOLEAN:'boolean',JSON:'json'}[input.type];
  if(!slot || Object.keys(input).some(k=>k!=='type'&&k!==slot) || !Object.hasOwn(input,slot))return null;
  switch(input.type){
    case 'STRING': return input.string===null||typeof input.string==='string'?{type:'STRING',value:input.string}:null;
    case 'NUMBER': return input.number===null||typeof input.number==='number'&&Number.isFinite(input.number)?{type:'NUMBER',value:input.number}:null;
    case 'BOOLEAN': return input.boolean===null||typeof input.boolean==='boolean'?{type:'BOOLEAN',value:input.boolean}:null;
    case 'JSON': return validCellJson(input.json,new Set(),0)?{type:'JSON',value:input.json as import('./html-page').HtmlJson}:null;
  }
}

function validCellJson(value:unknown,seen:Set<object>,depth:number):boolean {
  if(depth>32)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(!value||typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  const valid=Array.isArray(value)
    ? Object.keys(value).length===value.length && value.every(v=>validCellJson(v,seen,depth+1))
    : Object.getPrototypeOf(value)===Object.prototype && Reflect.ownKeys(value).every(k=>typeof k==='string'&&validCellJson((value as Record<string,unknown>)[k],seen,depth+1));
  seen.delete(value);return valid;
}
