import type {LocalDeclaration} from './local-contracts.ts';
import type {LegacyScalarOperation} from './scalar-mutation-contracts.ts';
/** Recognize only the complete arithmetic statement; SQLite separately proves rewritten SQL. */
export function readLegacyScalarOperation(sql:string,declarations:readonly LocalDeclaration[]):LegacyScalarOperation|null {
 if(!/\b_signals\b/i.test(sql))return null;
 const match=/^\s*update\s+_signals\s+set\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*([+-])\s*(\d+(?:\.\d+)?)\s*;?\s*$/i.exec(sql);
 if(!match)throw Error('Unsupported legacy scalar mutation');
 const target=declarations.find(d=>d.name.toLowerCase()===match[1]!.toLowerCase());
 const source=declarations.find(d=>d.name.toLowerCase()===match[2]!.toLowerCase());
 const operand=Number(match[4]);
 if(target?.type!=='number'||source?.type!=='number'||(source.default!==null&&!Number.isSafeInteger(source.default))||!Number.isSafeInteger(operand))throw Error('Unsupported legacy scalar mutation');
 return{target:target.name,source:source.name,operator:match[3] as '+'|'-',operand};
}
export function applyLegacyScalarOperation(op:LegacyScalarOperation,values:Record<string,unknown>):Record<string,unknown>{
 const value=values[op.source];
 if(value===null)return{[op.target]:null};
 if(typeof value!=='number'||!Number.isSafeInteger(value))throw Error('Invalid scalar mutation state');
 const next=op.operator==='+'?value+op.operand:value-op.operand;
 if(!Number.isSafeInteger(next))throw Error('Invalid scalar mutation result');
 return{[op.target]:next};
}
