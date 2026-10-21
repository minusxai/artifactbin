/**
 * Minimal edits to a JSON object's text: replace or append top-level members
 * while keeping every other byte (formatting, key order, unknown keys) as written.
 */
import type { AfJson } from "../af-contracts.ts";

interface Member {
  key: string;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
}
interface ObjectText {
  open: number;
  close: number;
  members: Member[];
}

const isSpace = (char: string | undefined) => char === " " || char === "\t" || char === "\n" || char === "\r";

function skipSpace(text: string, index: number): number {
  while (index < text.length && isSpace(text[index])) index++;
  return index;
}

function scanString(text: string, index: number): number {
  for (index++; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === '"') return index + 1;
  }
  return index;
}

function scanValue(text: string, index: number): number {
  const first = text[index];
  if (first === '"') return scanString(text, index);
  if (first === "{" || first === "[") {
    let depth = 0;
    for (; index < text.length; index++) {
      const char = text[index];
      if (char === '"') index = scanString(text, index) - 1;
      else if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) return index + 1;
      }
    }
    return index;
  }
  while (index < text.length && !isSpace(text[index]) && text[index] !== "," && text[index] !== "}" && text[index] !== "]")
    index++;
  return index;
}

/** Locate the members of a JSON object text that JSON.parse already accepted. */
function scanObject(text: string): ObjectText | null {
  let index = skipSpace(text, 0);
  if (text[index] !== "{") return null;
  const open = index;
  const members: Member[] = [];
  index = skipSpace(text, index + 1);
  if (text[index] === "}") return { open, close: index, members };
  for (;;) {
    index = skipSpace(text, index);
    const keyStart = index;
    const keyEnd = scanString(text, index);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    index = skipSpace(text, keyEnd) + 1;
    const valueStart = skipSpace(text, index);
    const valueEnd = scanValue(text, valueStart);
    members.push({ key, keyStart, keyEnd, valueStart, valueEnd });
    index = skipSpace(text, valueEnd);
    if (text[index] === ",") {
      index++;
      continue;
    }
    if (text[index] === "}") return { open, close: index, members };
    return null;
  }
}

/** Return `text` without the given top-level members, keeping every other byte as written. */
export function removeMembers(text: string, keys: readonly string[]): string {
  let output = text;
  for (;;) {
    const object = scanObject(output);
    if (!object) throw Error("Not a JSON object");
    const index = object.members.findIndex((member) => keys.includes(member.key));
    if (index < 0) return output;
    const members = object.members;
    const member = members[index]!;
    const [start, end] =
      members.length === 1
        ? [object.open + 1, object.close]
        : index < members.length - 1
          ? [member.keyStart, members[index + 1]!.keyStart]
          : [members[index - 1]!.valueEnd, member.valueEnd];
    output = output.slice(0, start) + output.slice(end);
  }
}

/** JSON that is safe inside a `<script>` element. */
export function scriptJson(value: AfJson): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * Return `text` with each key set to its value. Existing members whose value
 * is already equal are left byte for byte; new members are appended in the
 * object's own style.
 */
export function setMembers(text: string, entries: readonly (readonly [string, AfJson])[]): string {
  const object = scanObject(text);
  if (!object) throw Error("Not a JSON object");
  const edits: { start: number; end: number; text: string }[] = [];
  const appended: (readonly [string, AfJson])[] = [];
  for (const [key, value] of entries) {
    const existing = object.members.filter((member) => member.key === key);
    if (!existing.length) {
      appended.push([key, value]);
      continue;
    }
    for (const member of existing) {
      const current = JSON.parse(text.slice(member.valueStart, member.valueEnd)) as AfJson;
      if (JSON.stringify(current) !== JSON.stringify(value))
        edits.push({ start: member.valueStart, end: member.valueEnd, text: scriptJson(value) });
    }
  }
  if (appended.length) {
    const first = object.members[0];
    const last = object.members.at(-1);
    if (!first || !last) {
      const body = appended.map(([key, value]) => `${scriptJson(key)}: ${scriptJson(value)}`).join(", ");
      edits.push({ start: object.open, end: object.close + 1, text: `{ ${body} }` });
    } else {
      const lead = text.slice(object.open + 1, first.keyStart);
      const separator = lead.includes("\n") ? `,\n${lead.slice(lead.lastIndexOf("\n") + 1)}` : ", ";
      const colon = text.slice(first.keyEnd, first.valueStart);
      const added = appended.map(([key, value]) => `${separator}${scriptJson(key)}${colon}${scriptJson(value)}`).join("");
      edits.push({ start: last.valueEnd, end: last.valueEnd, text: added });
    }
  }
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
