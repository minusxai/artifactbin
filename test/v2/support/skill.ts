/**
 * The skill is the spec: acceptance tests read examples straight from it, so
 * a skill edit that changes an example changes what is tested.
 */
import { readFileSync, readdirSync } from "node:fs";
import { repositoryPath } from "./load.ts";

export const SKILL_ROOT = "skills/pagegi-author";

export function skillFile(relative: string): string {
  return readFileSync(repositoryPath(`${SKILL_ROOT}/${relative}`), "utf8");
}

export function skillFiles(relativeDirectory: string): string[] {
  return readdirSync(repositoryPath(`${SKILL_ROOT}/${relativeDirectory}`))
    .filter((name) => !name.startsWith("."))
    .sort();
}

export interface CodeBlock {
  language: string;
  code: string;
  /** 1-based line of the opening fence. */
  line: number;
}

export function codeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const open = /^```(\w*)\s*$/.exec(lines[index]!);
    if (!open) continue;
    const start = index;
    const body: string[] = [];
    for (index++; index < lines.length && lines[index] !== "```"; index++)
      body.push(lines[index]!);
    blocks.push({ language: open[1] ?? "", code: body.join("\n") + "\n", line: start + 1 });
  }
  return blocks;
}

/** The single code block in `file` containing `marker`; throws if there is not exactly one. */
export function skillExample(file: string, marker: string): CodeBlock {
  const found = codeBlocks(skillFile(file)).filter((block) =>
    block.code.includes(marker),
  );
  if (found.length !== 1)
    throw Error(
      `Expected one code block in ${file} containing ${JSON.stringify(marker)}, found ${found.length}`,
    );
  return found[0]!;
}
