import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { externalCompile } from "../conversion/compiled/index.ts";
import { resourceSha256 } from "./resources.ts";
import { nativeDigest } from "./selection.ts";
import { prepareNativeMarkdown } from "./markdown.ts";
import type {
  NativeMarkdownInput,
  NativeMarkdownParse,
} from "./markdown-contracts.ts";
const pin = "8eaac63810b66eb575b018be89bb63443e1b7aaf";
const files = [
  "services/app/lib/markdown/content.ts",
  "services/app/lib/markdown/code-block.ts",
  "services/app/lib/markdown/prism-grammars.ts",
  "services/utils/src/escape.ts",
  "package-lock.json",
];
export async function extractNativeMarkdown(
  input: Omit<NativeMarkdownInput, "parsed" | "parserSha256">,
  legacyRoot: string,
  targetRoot?: string,
) {
  const proof = [];
  for (const file of files) {
    const actual = await readFile(path.join(legacyRoot, file));
    const original = await promisify(execFile)(
      "git",
      ["show", `${pin}:${file}`],
      { cwd: legacyRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    );
    if (resourceSha256(actual) !== resourceSha256(original.stdout))
      throw Error("native_markdown_parser_changed");
    if (targetRoot && file !== "package-lock.json") {
      const target = await readFile(path.join(targetRoot, file));
      if (resourceSha256(target) !== resourceSha256(actual))
        throw Error("native_markdown_target_parser_changed");
    }
    proof.push({ path: file, sha256: resourceSha256(actual) });
  }
  const parsed = await externalCompile<
    readonly NativeMarkdownParse[],
    { nodes: NativeMarkdownInput["analysis"]["nodes"] }
  >(
    { nodes: input.analysis.nodes },
    { legacyRoot },
    "../../native-components/markdown-runner.mts",
  );
  return {
    receipts: prepareNativeMarkdown({
      ...input,
      parsed,
      parserSha256: nativeDigest(proof),
    }),
    proof,
  };
}
