/** Retained pure Markdown parser only; no authored JS evaluation or data access. */
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]!);
let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > 16 * 1024 * 1024)
    throw Error("native_markdown_input_limit");
}
const request = JSON.parse(raw),
  { markdownSource, markdownContent } = await import(
    pathToFileURL(path.join(root, "services/app/lib/markdown/content.ts")).href
  );
const output: unknown[] = [];
const walk = (nodes: any[]) => {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tag === "Markdown") {
      const source = markdownSource(node);
      if (source === null) throw Error("native_markdown_dynamic_source");
      output.push({
        sourceNode: node.graphKey,
        source,
        ...markdownContent(source),
      });
    } else walk(node.children);
  }
};
walk(request.nodes);
process.stdout.write(JSON.stringify(output));
