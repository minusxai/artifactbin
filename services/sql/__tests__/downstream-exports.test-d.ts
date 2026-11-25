/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { SqliteDatabase } from '@artifactbin/sql/core';
import type { SqlCaps, SqlExtensions, SqlPoolOptions } from '@artifactbin/sql/local';
import type { SqlCaps as LegacySqlCaps, SqlExtensions as LegacySqlExtensions } from '@artifactbin/sql/sqlite';
import type { SqlCaps as TestSqlCaps, SqlExtensions as TestSqlExtensions } from '@artifactbin/sql/testing';

expectTypeOf<[SqliteDatabase, SqlCaps, SqlExtensions, SqlPoolOptions]>().not.toBeNever();

expectTypeOf<[LegacySqlCaps, LegacySqlExtensions]>().toEqualTypeOf<[SqlCaps, SqlExtensions]>();

expectTypeOf<[TestSqlCaps, TestSqlExtensions]>().toEqualTypeOf<[SqlCaps, SqlExtensions]>();
