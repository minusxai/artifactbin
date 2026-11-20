/**
 * WHAT A STATEMENT TOUCHES, as SQLite reports it while preparing the
 * statement (its authorizer callback plus statement metadata). No rows are
 * read. The document compiler derives every dependency, signature and
 * placement decision from this record, so no other code parses SQL text.
 */

/**
 * A field of a built-in row (`$_me.id`) is written with a dot, which SQLite
 * parameters cannot contain. The compiler rewrites it to this parameter name
 * before SQLite sees the statement, and binds it by the same name.
 */
export const paramSqlName = (logical: string): string => logical.replace('.', '__');
