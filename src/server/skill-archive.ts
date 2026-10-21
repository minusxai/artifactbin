/**
 * GET /skills/pagegi-author.tgz: skills/pagegi-author/ as one gzip tarball,
 * written here (ustar) so the image needs no tar binary, built on the first
 * request and kept in memory.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { SkillArchive } from "./af-api-contracts.ts";

const skillDirectory = new URL("../../skills/pagegi-author/", import.meta.url);
/** The directory the archive extracts to. */
export const SKILL_ARCHIVE_ROOT = "pagegi-author";
/** The archive's bytes depend only on the skill's files, not on when the server built it. */
const MTIME = Date.UTC(2026, 0, 1) / 1000;

interface TarEntry {
  name: string;
  mode: number;
  body: Uint8Array;
  directory: boolean;
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

/** One 512-byte ustar header. Names stay under 100 bytes; the skill's paths are short. */
function header(entry: TarEntry): Uint8Array {
  const block = new Uint8Array(512);
  const put = (offset: number, text: string) => {
    const bytes = new TextEncoder().encode(text);
    block.set(bytes, offset);
  };
  if (new TextEncoder().encode(entry.name).length > 99)
    throw Error("Skill path too long for the archive: " + entry.name);
  put(0, entry.name);
  put(100, octal(entry.mode, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(entry.directory ? 0 : entry.body.length, 12));
  put(136, octal(MTIME, 12));
  put(148, "        ");
  put(156, entry.directory ? "5" : "0");
  put(257, "ustar\0");
  put(263, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return block;
}

function tar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    blocks.push(header(entry));
    if (entry.directory) continue;
    blocks.push(entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding) blocks.push(new Uint8Array(padding));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((size, block) => size + block.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

/** The skill's files in a fixed order, hidden entries left out. */
function skillEntries(directory: URL, name: string): TarEntry[] {
  const entries: TarEntry[] = [
    { name: name + "/", mode: 0o755, body: new Uint8Array(), directory: true },
  ];
  for (const child of readdirSync(directory, { withFileTypes: true })
    .filter((child) => !child.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const url = new URL(child.name + (child.isDirectory() ? "/" : ""), directory);
    if (child.isDirectory()) entries.push(...skillEntries(url, `${name}/${child.name}`));
    else
      entries.push({
        name: `${name}/${child.name}`,
        mode: statSync(url).mode & 0o777,
        body: readFileSync(url),
        directory: false,
      });
  }
  return entries;
}

let cached: SkillArchive | undefined;
export function skillArchive(): SkillArchive {
  return (cached ??= {
    body: gzipSync(tar(skillEntries(skillDirectory, SKILL_ARCHIVE_ROOT))),
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${SKILL_ARCHIVE_ROOT}.tgz"`,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
