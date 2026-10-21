import pg from "pg";
import { randomUUID } from "node:crypto";
export async function testDatabase() {
  const connectionString =
    process.env.PAGEGI_DATABASE_URL ||
    "postgres://pagegi:pagegi-local@127.0.0.1:55432/pagegi";
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  });
  return {
    connectionString,
    schema,
    pool,
    cleanup: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
