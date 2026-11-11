/**
 * Where the identity tables are, as SQL names. They stay in the APP's schema (the app's boot DDL declares them and
 * its role owns them; grants.sql takes its writes away and gives them to the auth role), so a host whose
 * connection's search_path is elsewhere (the production proxy, on the auth schema) names `APP__SCHEMA`; a
 * single-process install and the tests leave it out and read the connection's default.
 */
import {randomBytes} from 'node:crypto';
import {IDENTITY_OWNED_TABLES} from '@artifactbin/contracts';

export type IdentityTables = Record<(typeof IDENTITY_OWNED_TABLES)[number], string>;

export function identityTables(appSchema?: string): IdentityTables {
  if (appSchema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(appSchema)) throw new Error(`identity: app schema ${JSON.stringify(appSchema)} is not a plain identifier`);
  return Object.fromEntries(IDENTITY_OWNED_TABLES.map(table => [table, appSchema ? `${appSchema}.${table}` : table])) as IdentityTables;
}

/** 96 random bits as base36: the internal ids (`usr_`, `grp_`, `gin_`, `ga_`) every table keys on. */
export const internalId = (): string => BigInt('0x' + randomBytes(12).toString('hex')).toString(36);
export const tokenId = (): string => 'tok_' + BigInt('0x' + randomBytes(8).toString('hex')).toString(36);

/** A unique violation (`23505`): the one database refusal the module turns into an answer. */
export const isUniqueViolation = (error: unknown): boolean => (error as {code?: string} | null)?.code === '23505';
