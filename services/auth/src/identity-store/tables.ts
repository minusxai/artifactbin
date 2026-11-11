/**
 * Where the identity tables are, as SQL names: the base tables, in the identity module's own schema (AUTH__SCHEMA,
 * ./schema). Always qualified, so the store writes the base tables whatever the connection's search_path resolves
 * first (the app's resolves the read views of the same names).
 */
import {randomBytes} from 'node:crypto';
import {IDENTITY_OWNED_TABLES} from '@artifactbin/contracts';

export type IdentityTables = Record<(typeof IDENTITY_OWNED_TABLES)[number], string>;

export function identityTables(authSchema = 'auth'): IdentityTables {
  if (!/^[a-z_][a-z0-9_]*$/.test(authSchema)) throw new Error(`identity: auth schema ${JSON.stringify(authSchema)} is not a plain identifier`);
  return Object.fromEntries(IDENTITY_OWNED_TABLES.map(table => [table, `${authSchema}.${table}`])) as IdentityTables;
}

/** 96 random bits as base36: the internal ids (`usr_`, `grp_`, `gin_`, `ga_`) every table keys on. */
export const internalId = (): string => BigInt('0x' + randomBytes(12).toString('hex')).toString(36);
export const tokenId = (): string => 'tok_' + BigInt('0x' + randomBytes(8).toString('hex')).toString(36);

/** A unique violation (`23505`): the one database refusal the module turns into an answer. */
export const isUniqueViolation = (error: unknown): boolean => (error as {code?: string} | null)?.code === '23505';
