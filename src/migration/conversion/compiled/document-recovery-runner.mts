import path from "node:path";
import { pathToFileURL } from "node:url";
import { recoverLegacyDocumentSource } from "../document-recovery.ts";
const root = path.resolve(process.argv[2]!);
let text = "";
for await (const part of process.stdin) text += part;
const input = JSON.parse(text),
  load = (name: string) =>
    import(pathToFileURL(path.join(root, "services/app/lib", name)).href);
const [
  { graphNodes },
  { decodeDocumentNodes },
  { serializeJsx },
  { parseJsx },
] = await Promise.all([
  load("document/document-graph.ts"),
  load("document/document-node-codec.ts"),
  load("jsx/serialize.ts"),
  load("jsx/parse.ts"),
]);
const result = recoverLegacyDocumentSource(input.document, {
  ownSource: (ast) => serializeJsx(decodeDocumentNodes(ast)),
  canonicalDocument: (document) => serializeJsx(graphNodes(document)),
  canonicalSource: (source) => {
    const parsed = parseJsx(source);
    if (!parsed.ok) throw Error("Recovery parse refused");
    return serializeJsx(parsed.nodes);
  },
});
if (!result) throw Error("Retained document recovery refused");
process.stdout.write(JSON.stringify(result));
