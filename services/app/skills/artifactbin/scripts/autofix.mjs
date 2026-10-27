/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION =
  `Fix platform-owned HTML pieces in place and list problems to fix by hand.
publish and serve already run it.
Usage: node scripts/autofix.mjs FILE [--dry-run] [--root DIR]
Flags: --dry-run lists problems and pending fixes and writes nothing; --root DIR is the project boundary for local
  file checks (default: the file's directory). Common: --json (full fixes and problems), --output FILE, --help.
Examples:
  node scripts/autofix.mjs ./project/index.html
  node scripts/autofix.mjs ./project/index.html --dry-run --json
Gotchas: HTML files only. The file is rewritten atomically only when something was fixed. Exit 1 means problems
  remain for you to fix (for example duplicate ids); fixes already made stay written.
  Run it yourself only for a file you are not publishing or serving.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results never contain credentials.`;

/** The autofix pass for one HTML file (rules: lib/html-autofix). publish.mjs and serve.mjs run the same pass themselves. */
import path from 'node:path';
import {statSync} from 'node:fs';
import {readFile, writeFile, rename, realpath} from 'node:fs/promises';
import {autofixHtml, formatAutofixReport} from './preview-html.mjs';
import {runTool, positional, ToolError, within} from './toolbox-client.mjs';
/** A local reference exists when it is a file inside the project root, or a dependency the baseline already published (`mapped`, root-relative). */
export function localExists(file, root, mapped = () => false) {
  const directory = path.dirname(file);
  return relative => {
    const full = path.resolve(directory, relative);
    if (mapped(path.relative(root, full).split(path.sep).join('/'))) return true;
    if (!within(root, full)) return false;
    try {
      return statSync(full).isFile();
    } catch {
      return false;
    }
  };
}
// Run the autofix rules over one HTML source; `exists` lets a rule tell a real local file from a missing one.
export function autofixSource(source, {file, root, mapped}) {
  return autofixHtml(source, {exists: localExists(file, root ?? path.dirname(file), mapped)});
}
/** Full detail for --json and saved results; the printed report is capped. */
export const autofixDetail = (result, report) => ({
  clean: !result.fixes.length && !result.problems.length,
  fixes: result.fixes,
  problems: result.problems,
  routine: result.routine,
  ...(report ? {report} : {})
});
// Write beside the file and rename, so an interrupted run never leaves half a page.
export async function replaceFile(file, text) {
  const temporary = `${file}.autofix-${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, file);
}
/** @param {{values:any,positionals:string[]}} parsed @param {{log?:(text:string)=>
  void}} [options] */
export async function autofixCommand({values, positionals}, {log = text => process.stdout.write(
  text)} = {}) {
  const file = await realpath(positional(positionals));
  if (!/\.html?$/i.test(file)) throw new ToolError('not_html', 'autofix checks HTML pages only.', 2);
  const root = await realpath(values.root ?? path.dirname(file));
  if (!within(root, file))
    throw new ToolError('source_outside_root', 'Source is outside the selected project root.', 2);
  // Fixes are applied in memory first; the file changes only when a fix landed and this is not a dry run.
  const result = autofixSource(await readFile(file, 'utf8'), {file, root});
  const write = !values['dry-run'] && result.changed;
  if (write) await replaceFile(file, result.html);
  const landed = values['dry-run']
    ? 'dry run; nothing written'
    : write
      ? `written to ${path.basename(file)}`
      : undefined;
  const report = formatAutofixReport(result, {
    file: path.basename(file),
    landed,
    dryRun: values['dry-run'],
    routine: result.routine
  });
  if (result.problems.length) process.exitCode = 1;
  if (values.json) return {file, written: write, ...autofixDetail(result, report)};
  log(report);
}
await runTool('autofix', import.meta.url, autofixCommand);
