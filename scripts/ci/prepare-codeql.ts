import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeQLConfig } from "./codeql-coverage.ts";
const [partition] = process.argv.slice(2);
if (!process.env.GITHUB_WORKSPACE || !process.env.GITHUB_OUTPUT)
  throw Error("Missing CodeQL runner environment");
const file = join(process.env.GITHUB_WORKSPACE, ".pagegi-codeql-config.yml");
writeFileSync(file, codeQLConfig(partition!));
appendFileSync(process.env.GITHUB_OUTPUT, `config=${file}\n`);
