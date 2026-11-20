import {z} from 'zod';
import type { DatasetColumn, ColumnType } from '@artifactbin/contracts/sql';

/** One schema parser for imports, catalog definitions and author declarations. */
export function parseDatasetColumn(raw: unknown): DatasetColumn {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Column must be {name, type, constraints?}');
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name || c.name.includes('\0') || !['string','number','boolean','date','timestamp','user'].includes(String(c.type))) throw new Error('Invalid column name or type; use string, number, boolean, date, timestamp or user');
  if (Object.keys(c).some(k => !['name','type','constraints','choices'].includes(k))) throw new Error('Unknown column attribute');
  const column: DatasetColumn = {name:c.name, type:c.type as ColumnType};
  if(c.choices!==undefined){
    if(!Array.isArray(c.choices)||!c.choices.length||c.choices.length>100||c.choices.some(v=>v===null||typeof v!==(c.type==='number'?'number':c.type==='boolean'?'boolean':'string')||(typeof v==='number'&&!Number.isFinite(v)))||new Set(c.choices).size!==c.choices.length)throw new Error('Column choices must be 1–100 unique values matching its type');
    column.choices=[...c.choices];
  }
  if (c.constraints !== undefined) {
    if (c.type !== 'user' || !c.constraints || typeof c.constraints !== 'object' || Array.isArray(c.constraints)) throw new Error('User constraints must be an object');
    const constraints = c.constraints as Record<string,unknown>;
    if (Object.keys(constraints).some(k => !['memberOf','self'].includes(k))) throw new Error('Unknown user constraint');
    if (constraints.self !== undefined && typeof constraints.self !== 'boolean') throw new Error('self must be boolean');
    const scopes = constraints.memberOf;
    if (scopes !== undefined && (!Array.isArray(scopes) || !scopes.length || scopes.some(s => typeof s !== 'string' || (s !== 'current' && !/^ref:[A-Za-z0-9]{6,12}$/.test(s))) || new Set(scopes).size !== scopes.length)) throw new Error('memberOf must be a nonempty array of unique document references or current');
    column.constraints = {...(scopes !== undefined ? {memberOf:[...(scopes as string[])]} : {}), ...(constraints.self !== undefined ? {self:constraints.self as boolean} : {})};
  }
  return column;
}
const identifierShape=z.string().min(1).refine(value=>!value.includes('\0')&&new TextEncoder().encode(value).length<=63,'Identifiers must contain at most 63 UTF-8 bytes and no NUL');
const tableShape=z.object({schema:identifierShape,name:identifierShape,columns:z.array(z.union([identifierShape,z.unknown().transform((raw,ctx)=>{try{return parseDatasetColumn(raw);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid column'});return z.NEVER;}})])).optional(),sql:z.string().min(1).max(100000).optional(),rows:z.array(z.record(z.string(),z.unknown())).optional()}).strict().superRefine((table,ctx)=>{
 const sources=[table.sql,table.rows].filter(value=>value!==undefined);
 if(sources.length>1)ctx.addIssue({code:'custom',message:'A table can have only one source'});
});
export const catalogInputShape=z.object({kind:z.literal('stored'),defaultSchema:identifierShape.optional(),refreshSeconds:z.number().int().min(0).max(86400).optional(),tables:z.array(tableShape).min(1).max(200)}).strict();
