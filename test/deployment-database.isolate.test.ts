/** Fresh PostgreSQL initialization separates bootstrap authority from app migrations. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";

test("bootstrap app role migrates its database but cannot administer the cluster or connect elsewhere", async (t) => {
  const name = "afv2-database-test-" + randomUUID();
  const password = "test-only-'quoted-password";
  const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  docker("run", "-d", "--rm", "--name", name,
    "-e", "POSTGRES_USER=artefactv2_admin", "-e", "POSTGRES_DB=artefactv2",
    "-e", "POSTGRES_PASSWORD=test-only-admin", "-e", "ARTEFACTV2_APP_DATABASE_PASSWORD=" + password,
    "-v", resolve("deploy/init-artefactv2-database.sh") + ":/docker-entrypoint-initdb.d/10-app-role.sh:ro",
    "postgres:17-bookworm");
  t.after(() => docker("rm", "-f", name));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "artefactv2_admin", "-d", "artefactv2"); ready = true; break; }
    catch { await setTimeout(100); }
  }
  assert.ok(ready, "fresh database initialization completed");
  const sql = (database: string, statement: string) => docker("exec", "-e", "PGPASSWORD=" + password, name,
    "psql", "-h", "127.0.0.1", "-U", "artefactv2", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", statement);
  assert.equal(sql("artefactv2", "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user"), "f");
  sql("artefactv2", "CREATE TABLE app_probe (value text); INSERT INTO app_probe VALUES ('ok'); CREATE SCHEMA app_migration; CREATE TABLE app_migration.probe(id int)");
  assert.equal(sql("artefactv2", "SELECT value FROM app_probe"), "ok");
  for (const statement of ["CREATE DATABASE forbidden", "CREATE ROLE forbidden", "ALTER ROLE artefactv2 SUPERUSER"])
    assert.throws(() => sql("artefactv2", statement), /Command failed/);
  for (const database of ["postgres", "template1"])
    assert.throws(() => sql(database, "SELECT 1"), /Command failed/);
});
