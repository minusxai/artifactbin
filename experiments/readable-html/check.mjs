import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const base = "experiments/readable-html/";
const ts = [
  "--noEmit",
  "--strict",
  "--skipLibCheck",
  "--target",
  "ES2022",
  "--module",
  "NodeNext",
  "--moduleResolution",
  "NodeNext",
  "--allowImportingTsExtensions",
  "--lib",
  "ES2022,DOM,DOM.Iterable",
  "--types",
  "node",
];
const checks = [
  ["source types", "npm", ["run", "--prefix", base + "source", "typecheck"]],
  ["source behavior", "npm", ["run", "--prefix", base + "source", "test"]],
  [
    "auth types",
    "./node_modules/.bin/tsc",
    ["-p", base + "auth/tsconfig.json"],
  ],
  [
    "auth policy",
    "node",
    ["--test", base + "auth/policy.test.mjs", base + "auth/pairing.test.mjs"],
  ],
  ["auth browsers", "node", [base + "auth/browser.mjs"]],
  [
    "replay types",
    "./node_modules/.bin/tsc",
    [
      ...ts,
      ...["contracts.ts", "session.ts", "assembler.ts", "model.test.ts"].map(
        (f) => base + "replay/" + f,
      ),
    ],
  ],
  [
    "replay policy",
    "node",
    ["--import", "tsx", "--test", base + "replay/model.test.ts"],
  ],
  ["replay browsers", "node", [base + "replay/browser.mjs"]],
  [
    "replay negative control",
    "node",
    [base + "replay/active-negative-control.mjs"],
  ],
  [
    "workflow types",
    "./node_modules/.bin/tsc",
    [
      ...ts,
      ...[
        "contracts.ts",
        "workflow.ts",
        "workflow.test.ts",
        "codec-integration.test.ts",
      ].map((f) => base + "workflow/" + f),
    ],
  ],
  [
    "workflow behavior",
    "node",
    [
      "--import",
      "tsx",
      "--test",
      base + "workflow/workflow.test.ts",
      base + "workflow/codec-integration.test.ts",
    ],
  ],
  ["workflow mutation checks", "node", [base + "workflow/mutations.mjs"]],
  ["markdown checks", "npm", ["run", "--prefix", base + "markdown", "check"]],
  [
    "composition types",
    "./node_modules/.bin/tsc",
    [
      ...ts,
      "--allowJs",
      base + "integration-contracts.ts",
      base + "integration-runtime.ts",
    ],
  ],
  ["composition browsers", "node", [base + "integration.mjs"]],
  ["acceptance types", "./node_modules/.bin/tsc", [...ts, "--allowJs", "--checkJs", base+"acceptance/contracts.ts", base+"acceptance/receipt.mjs"]],
  ["acceptance runtime types", "./node_modules/.bin/tsc", [...ts, "--allowJs", base+"acceptance/runtime.ts"]],
  ["acceptance receipts", "node", ["--test", base+"acceptance/receipt.test.mjs"]],
  ["acceptance browsers", "node", ["--import", "tsx", base+"acceptance/browser.mjs"]],
  ["GraphQL contracts and negative controls", "npm", ["run", "--prefix", base+"graphql", "check"]],
  ["isolate types", "./node_modules/.bin/tsc", [...ts, ...["contracts.ts","host.ts","host.test.ts"].map(f=>base+"isolates/"+f)]],
  ["isolate runtime", "npm", ["test", "--prefix", base+"isolates"]],
  ["isolate OS resource boundary", "node", [base+"isolates/container/check.mjs"]],
  ["isolate sandbox capability bridge", "node", [base+"isolates/container/cap-check.mjs"]],
  ["connector types", "./node_modules/.bin/tsc", [...ts, base+"connectors/contracts.ts",base+"connectors/host.d.mts"]],
  ["connector behavior", "node", ["--test",base+"connectors/connector.test.mjs"]],
  ["replication types", "./node_modules/.bin/tsc", [...ts, ...["contracts.ts","model.ts","durable.ts","model.test.ts","durable.test.ts","crash-worker.ts"].map(f=>base+"replication/"+f)]],
  ["replication behavior and crash recovery", "node", ["--import","tsx","--test",base+"replication/model.test.ts",base+"replication/durable.test.ts"]],
  ["cross-phase types", "./node_modules/.bin/tsc", [...ts,...["contracts.ts","all-phases.test.ts","client.ts","client-contracts.ts"].map(f=>base+"composition/"+f)]],
  ["cross-phase backend", "node", ["--import","tsx","--test",base+"composition/all-phases.test.ts"]],
  ["cross-phase browsers", "node", [base+"composition/browser.mjs"]],
];
for (const [name, command, args] of checks) {
  console.log("\nVALIDATE: " + name);
  const result = spawnSync(command, args, {
    cwd: resolve(root),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("\nAll readable-HTML candidate checks passed.");
