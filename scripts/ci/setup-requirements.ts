import { browserRuntimePlan } from "./browser-runtime.ts";
import {
  backendContextFingerprint,
  datasetSqlContextFingerprint,
} from "./backend-cache.ts";
import { appendFileSync } from "node:fs";
import { setupRequirements } from "./inventory.ts";
const [kind = "validate", shard = "0", engine = "chromium"] =
  process.argv.slice(2);
const requirements = setupRequirements(kind, Number(shard), 4, engine);
if (!process.env.GITHUB_OUTPUT) throw Error("Missing GITHUB_OUTPUT");
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `browsers=${requirements.browsers.join(" ")}\n`,
);

if (requirements.backend)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `backend-key=${backendContextFingerprint({ root: "src/backend/container", platform: process.platform, architecture: process.arch })}\n`,
  );

const runtime = browserRuntimePlan(requirements.browsers);
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `host-browsers=${runtime.kind === "host" ? runtime.engines.join("-") : ""}\n`,
);

if (process.env.GITHUB_ENV)
  appendFileSync(
    process.env.GITHUB_ENV,
    `PAGEGI_CI_BROWSER_IMAGE=${runtime.kind === "image"}\n`,
  );

if (requirements.backend)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `dataset-sql-key=${datasetSqlContextFingerprint({ root: ".", platform: process.platform, architecture: process.arch })}\n`,
  );
