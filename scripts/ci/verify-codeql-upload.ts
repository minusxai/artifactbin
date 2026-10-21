import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exportedCodeQLRules } from "./codeql-upload.ts";
import { waitForCodeQLUpload } from "./codeql-polling.ts";
import { setTimeout } from "node:timers/promises";

const [sarifId, category, directory] = process.argv.slice(2);
const {
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: sha,
  GITHUB_REF: ref,
} = process.env;
if (
  !sarifId ||
  !category ||
  !directory ||
  !token ||
  !repository ||
  !sha ||
  !ref ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository)
)
  throw Error("Missing CodeQL upload verification environment");
const files = readdirSync(directory).filter((file) => file.endsWith(".sarif"));
if (!files.length) throw Error("Missing exported CodeQL SARIF");
const rules = files.reduce(
  (sum, file) =>
    sum +
    exportedCodeQLRules(
      JSON.parse(readFileSync(join(directory, file), "utf8")),
    ),
  0,
);
async function get(path: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/code-scanning/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(20_000, Math.ceil(timeoutMs))),
    },
  );
  if (!response.ok || response.headers.get("link")?.includes('rel="next"'))
    throw Error(`CodeQL verification API failed (${response.status})`);
  return response.json();
}
const processing = await waitForCodeQLUpload(
  { sarifId, sha, ref, category, rules },
  {
    now: () => performance.now(),
    sleep: async (milliseconds) => {
      await setTimeout(milliseconds);
    },
    status: (timeoutMs) =>
      get(`sarifs/${encodeURIComponent(sarifId)}`, timeoutMs),
    analyses: (timeoutMs) =>
      get(
        `analyses?sarif_id=${encodeURIComponent(sarifId)}&per_page=100`,
        timeoutMs,
      ),
  },
);
console.log(
  `Verified stored CodeQL analysis: ${rules} exported rules, exact checked commit and upload; ${processing.polls} polls over ${(processing.elapsedMs / 1000).toFixed(2)}s`,
);
