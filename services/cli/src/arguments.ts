import {CliError} from './errors';

/** Normalize only closed CLI-owned enums, never arbitrary names, identifiers or data. */
export function enumArgument<T extends string>(value:string,choices:readonly T[],label:string):T{
 const normalized=value.replace(/[A-Z]/g,character=>character.toLowerCase());
 if(!choices.includes(normalized as T))throw new CliError('invalid_choice',`Invalid ${label}: ${value}.`,`Choose ${choices.join(', ')}.`);
 return normalized as T;
}
