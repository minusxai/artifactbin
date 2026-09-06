import {z} from 'zod';
export const connectionShape=z.object({host:z.string().trim().min(1).max(253),port:z.number().int().min(1).max(65535),database:z.string().min(1).max(128),username:z.string().min(1).max(128),ssl:z.boolean(),passwordSecretId:z.string().regex(/^sec_[a-f0-9]{24}$/)}).strict();
export const secretTargetShape=connectionShape.omit({passwordSecretId:true});
export const identifierShape=z.string().min(1).refine(value=>!value.includes('\0')&&Buffer.byteLength(value,'utf8')<=63,'Identifiers must contain at most 63 UTF-8 bytes and no NUL');
const tableShape=z.object({schema:identifierShape,name:identifierShape,source:z.object({schema:identifierShape,table:identifierShape}).strict().optional(),columns:z.array(identifierShape).optional(),sql:z.string().min(1).max(100000).optional(),rows:z.array(z.record(z.string(),z.unknown())).optional(),modelCellId:identifierShape.optional()}).strict().superRefine((table,ctx)=>{
 const sources=[table.source,table.sql,table.rows,table.modelCellId].filter(value=>value!==undefined);
 if(sources.length>1)ctx.addIssue({code:'custom',message:'A table can have only one source'});
});
export const catalogInputShape=z.object({kind:z.enum(['postgres','stored']),connection:connectionShape.optional(),notebook:z.object({cells:z.array(z.object({id:identifierShape,name:identifierShape,sql:z.string().min(1).max(100000)}).strict()).max(200)}).strict().optional(),defaultSchema:identifierShape.optional(),refreshSeconds:z.number().int().min(0).max(86400).optional(),tables:z.array(tableShape).min(1).max(200)}).strict();
