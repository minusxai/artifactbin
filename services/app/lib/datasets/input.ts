import {parseDatasetColumn} from '@artifactbin/utils/shape';
import {z} from 'zod';
const identifierShape=z.string().min(1).refine(value=>!value.includes('\0')&&Buffer.byteLength(value,'utf8')<=63,'Identifiers must contain at most 63 UTF-8 bytes and no NUL');
const tableShape=z.object({schema:identifierShape,name:identifierShape,columns:z.array(z.union([identifierShape,z.unknown().transform((raw,ctx)=>{try{return parseDatasetColumn(raw);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid column'});return z.NEVER;}})])).optional(),sql:z.string().min(1).max(100000).optional(),rows:z.array(z.record(z.string(),z.unknown())).optional()}).strict().superRefine((table,ctx)=>{
 const sources=[table.sql,table.rows].filter(value=>value!==undefined);
 if(sources.length>1)ctx.addIssue({code:'custom',message:'A table can have only one source'});
});
export const catalogInputShape=z.object({kind:z.literal('stored'),defaultSchema:identifierShape.optional(),refreshSeconds:z.number().int().min(0).max(86400).optional(),tables:z.array(tableShape).min(1).max(200)}).strict();
