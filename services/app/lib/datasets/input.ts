import {z} from 'zod';
export const connectionShape=z.object({host:z.string().trim().min(1).max(253),port:z.number().int().min(1).max(65535),database:z.string().min(1).max(128),username:z.string().min(1).max(128),ssl:z.boolean(),passwordSecretId:z.string().regex(/^sec_[a-f0-9]{24}$/)}).strict();
export const secretTargetShape=connectionShape.omit({passwordSecretId:true});
const identifier=z.string().min(1).max(63);
const tableShape=z.object({schema:identifier,name:identifier,source:z.object({schema:identifier,table:identifier}).strict().optional(),columns:z.array(identifier).optional(),sql:z.string().min(1).max(100000).optional(),rows:z.array(z.record(z.string(),z.unknown())).optional(),modelCellId:z.string().min(1).optional()}).strict();
export const catalogInputShape=z.object({kind:z.enum(['postgres','stored']),connection:connectionShape.optional(),notebook:z.object({cells:z.array(z.object({id:z.string().min(1),name:identifier,sql:z.string().min(1).max(100000)}).strict()).max(200)}).strict().optional(),defaultSchema:identifier.optional(),refreshSeconds:z.number().int().min(0).max(86400).optional(),tables:z.array(tableShape).min(1).max(200)}).strict();
