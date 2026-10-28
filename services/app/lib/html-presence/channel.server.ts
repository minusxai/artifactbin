import {createHash} from 'node:crypto';
/** Case-sensitive page IDs stay isolated even where LISTEN folds SQL identifiers. */
export const presenceChannel=(id:string)=>`af_presence_${createHash('sha256').update(id).digest('hex').slice(0,40)}`;
