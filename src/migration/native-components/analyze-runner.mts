/** Offline extraction subprocess only. No rendering, authored evaluation, schema loading or network. */
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]!);
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw Error("native_analysis_input_limit");
}
const { document } = JSON.parse(text);
const load = (name: string) =>
  import(pathToFileURL(path.join(root, "services/app/lib", name)).href);
const [{ graphNodes }, { splitHelmet, dataflowOf }] = await Promise.all([
  load("document/document-graph.ts"),
  load("document/helmet.ts"),
]);
const nodes = graphNodes(document);
const { content } = splitHelmet(nodes);
process.stdout.write(JSON.stringify({ nodes, flow: dataflowOf(content) }));
