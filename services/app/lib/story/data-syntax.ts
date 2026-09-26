/**
 * WHICH SQL A DOCUMENT'S DATA HALF IS WRITTEN IN. `meta.dataSyntax: 2` is the
 * SQLite syntax (`<Import>`, `set=`, `$_me.id`); a document without it was
 * written for the previous query engine (DuckDB: `source=` + `public.rows`,
 * `_signals`, bare `$_me`).
 *
 * The text alone cannot tell the two apart — `a / b` parses in both and divides
 * integers differently — so the answer is a durable marker, set by the writes
 * that validate a whole document under the current rules: every creation and
 * every whole-document write. A partial edit keeps what the document had. The
 * one-off migration (lib/sqlite-syntax-migration) converts each unmarked
 * document once; nothing converts a marked one.
 */
export const DATA_SYNTAX = 2;

/** The marker as the metadata patch a write merges in. */
export const DATA_SYNTAX_META = { dataSyntax: DATA_SYNTAX } as const;

export const hasCurrentDataSyntax = (meta: unknown): boolean =>
  !!meta && typeof meta === 'object' && (meta as { dataSyntax?: unknown }).dataSyntax === DATA_SYNTAX;

/**
 * What each query of an archived version says when it was written for the
 * previous engine and the migration's converter cannot carry it over without a
 * person (lib/archived-version) — in place of failing on syntax this engine refuses.
 */
export const PREVIOUS_ENGINE = 'This version was written for the previous query engine and cannot run on the current one';

/**
 * Why an archived version written for the previous engine, which the
 * converter cannot carry over without a person, is not restored as it stands:
 * restoring it would publish syntax the current engine refuses or reads
 * differently. Said by the version read-back (`previous_engine`), for the
 * browser and CLI restores to refuse with.
 */
export const previousEngineRestore = (version: number): string =>
  `Version ${version} was written for the previous query engine and needs converting by hand, so it cannot be restored as it stands. Read it, and carry what you need into the current document.`;
