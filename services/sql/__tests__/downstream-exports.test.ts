/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/sql. The private server repository
 * (minusxai/artifactbin-server) composes its SQL service and generation extension from these names; removing one
 * breaks that build, which no other check here sees. Named imports, so knip's entry-export check
 * (knip.config.js `includeEntryExports`) counts them as used and refuses every other unused export. Regenerated
 * from artifactbin-server f1741b6 on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { SqliteDatabase } from '@artifactbin/sql/core';
import { createSql, type SqlCaps, type SqlExtensions, type SqlPoolOptions } from '@artifactbin/sql/local';
import { createSqliteSql } from '@artifactbin/sql/sqlite';

it('exports the values the deployment imports', () => {
  const values = { serveSql, sqlClient, createSql, createSqliteSql };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[SqliteDatabase, SqlCaps, SqlExtensions, SqlPoolOptions]>().not.toBeNever();
});
