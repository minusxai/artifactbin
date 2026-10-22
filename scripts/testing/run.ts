import { requiredMigrationInputs } from "./migration-requirements.ts";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { testConcurrency } from "./concurrency.ts";
import {
  discoverAcceptanceTests,
  discoverTests,
  selectAcceptanceTests,
  selectTests,
  setupRequirements,
} from "./inventory.ts";
const [stage = "unit", ...options] = process.argv.slice(2);
async function run(argv: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Test command exited ${code}: ${argv[0]}`)),
    );
  });
}
async function main(): Promise<void> {
  if (options.length)
    throw Error(
      "Usage: node scripts/testing/run.ts [unit|local|database|browser|isolate|integration|all|required-migration|v2|v2:<capability>]",
    );
  const tests = stage.startsWith("v2")
    ? selectAcceptanceTests(discoverAcceptanceTests(), stage)
    : selectTests(discoverTests(), stage);
  if (!tests.length) throw Error(`No tests discovered for stage ${stage}`);
  if (stage === "required-migration") {
    const inputs = requiredMigrationInputs(process.env, existsSync);
    const pg = createRequire(import.meta.url)("pg");
    const pool = new pg.Pool({
      connectionString: inputs.databaseUrl,
      connectionTimeoutMillis: 1500,
    });
    try {
      await pool.query("SELECT 1");
    } catch {
      throw Error(
        "Required migration verification needs reachable disposable PostgreSQL at MIGRATION_TEST_DATABASE_URL",
      );
    } finally {
      await pool.end();
    }
  }
  const needs = setupRequirements(tests);
  if (needs.postgres) {
    const pg = createRequire(import.meta.url)("pg");
    const pool = new pg.Pool({
      connectionString:
        process.env.PAGEGI_DATABASE_URL ||
        "postgres://pagegi:pagegi-local@127.0.0.1:55432/pagegi",
      connectionTimeoutMillis: 1500,
    });
    try {
      await pool.query("SELECT 1");
    } catch {
      throw Error(
        `The ${stage} test stage needs a disposable PostgreSQL database. Set PAGEGI_DATABASE_URL or start the documented local test database.`,
      );
    } finally {
      await pool.end();
    }
  }
  if (needs.browsers.length) {
    const engines = await import("playwright");
    for (const browser of needs.browsers)
      if (!existsSync(engines[browser].executablePath()))
        throw Error(
          `The ${stage} test stage needs installed browsers. Run npx playwright install --with-deps chromium firefox webkit.`,
        );
  }
  if (needs.build) await run(["npm", "run", "build"]);
  if (needs.backend) {
    await run(["npm", "run", "build:backend"]);
    await run(["npm", "run", "build:dataset-sql"]);
    await run(["npm", "run", "build:image-processor"]);
  }
  console.log(`Running ${tests.length} ${stage} test files`);
  await run([
    process.execPath,
    // Unit tests use the native TypeScript support required by our Node engine.
    // Keep the existing loader for capability stages with integration dependencies.
    ...(tests.every((test) => test.capability === "unit")
      ? []
      : ["--import", "tsx"]),
    "--test",
    `--test-concurrency=${testConcurrency(tests, { availableParallelism: availableParallelism(), ci: Boolean(process.env.CI) })}`,
    ...tests.map((test) => test.file),
  ]);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Test stage failed");
  process.exitCode = 1;
});
