import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {sanitizeMermaidSvg} from "../src/migration/conversion/compiled/mermaid-svg.ts";
import { validateCompiledTransport } from "../src/migration/conversion/compiled/transport.ts";
import type { CompiledTransportInput } from "../src/migration/conversion/compiled/transport-contracts.ts";
const svg = sanitizeMermaidSvg(
  '<svg id="diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text>/api/saved</text></svg>').svg;
const code = 'flowchart LR; A["/api/saved"] --> B[Done]',
  plans = [
    {
      id: "diagram",
      code,
      compiledClass: "",
      variants: { light: { svg }, dark: { svg } },
    },
  ] as any;
const runtime = `import {createSignal} from 'solid-js';const plans=${JSON.stringify(plans)};export function Mermaid(p){return [plans,p,createSignal];}`;
async function fixture(
  extra = "",
  entryOverride?: string,
  runtimeOverride?: string,
): Promise<CompiledTransportInput> {
  const entry =
    entryOverride ??
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';globalThis.saved=component(Diagram,{id:'diagram',code:${JSON.stringify(code)}});${extra}`;
  const runtimeSource = runtimeOverride ?? runtime;
  const result = await build({
    stdin: {
      contents: entry,
      sourcefile: "migration-entry.js",
      resolveDir: process.cwd(),
    },
    outfile: "migration.js",
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    sourcemap: "external",
    sourcesContent: true,
    external: ["@mx/rt", "solid-js", "unknown", code],
    plugins: [
      {
        name: "fixture",
        setup(b) {
          b.onResolve({ filter: /^@mx\/kit\/mermaid$/ }, () => ({
            path: "mermaid",
            namespace: "migration-mermaid",
          }));
          b.onLoad({ filter: /.*/, namespace: "migration-mermaid" }, () => ({
            contents: runtimeSource,
            loader: "js",
          }));
        },
      },
    ],
  });
  return {
    javascript: result.outputFiles.find((f) => f.path.endsWith(".js"))!.text,
    sourceMap: result.outputFiles.find((f) => f.path.endsWith(".map"))!.text,
    mermaid: {
      entry: { name: "migration-entry.js", source: entry },
      runtime: { name: "migration-mermaid:mermaid", source: runtimeSource },
      plans,
    },
  };
}
test("only exact trusted Mermaid metadata and renderer props may contain route text", async () => {
  const input = await fixture();
  assert.doesNotThrow(() => validateCompiledTransport(input));
  assert.throws(() =>
    validateCompiledTransport({ javascript: input.javascript }),
  );
});
test("same source code in executable or unknown data contexts stays refused", async () => {
  for (const extra of [
    `fetch(${JSON.stringify(code)});`,
    `globalThis.x={code:${JSON.stringify(code)}};`,
    `new URL(${JSON.stringify(code)},location.href);`,
    `import(${JSON.stringify(code)});`,
  ]) {
    const input = await fixture(extra);
    assert.throws(() => validateCompiledTransport(input));
  }
});
test("split executable transport references and routes remain refused", () => {
  for (const javascript of [
    `fetch('/'+'api/private');`,
    `new globalThis['Web'+'Socket']('wss://example.invalid');`,
    `globalThis['Event'+'Source'];`,
    `fetch(\`/\${'api'}/saved\`);`,
    `const boot='@mx/'+'boot';`,
  ])
    assert.throws(() => validateCompiledTransport({ javascript }));
  assert.doesNotThrow(() =>
    validateCompiledTransport({
      javascript: 'const harmless="Saved diagram";',
    }),
  );
});
test("changed IDs, source, call binding and nonliteral code cannot obtain provenance", async () => {
  for (const entry of [
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';component(Diagram,{id:'changed',code:${JSON.stringify(code)}});`,
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';component(Diagram,{code:${JSON.stringify(code)}});`,
    `import {createComponent as component} from 'unknown';import {Mermaid as Diagram} from '@mx/kit/mermaid';component(Diagram,{id:'diagram',code:${JSON.stringify(code)}});`,
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';function shadow(Diagram){return component(Diagram,{id:'diagram',code:${JSON.stringify(code)}})}globalThis.x=shadow;`,
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';globalThis.shadow=class Diagram{static proof=component(Diagram,{id:'diagram',code:${JSON.stringify(code)}})};`,
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';component(Diagram,{id:'diagram',code:String.raw\`${code}\`});`,
    `import {createComponent as component} from '@mx/rt';import {Mermaid as Diagram} from '@mx/kit/mermaid';component(Diagram,{id:'diagram',code:\`${code}\${globalThis.x}\`});`,
  ]) {
    const input = await fixture("", entry);
    assert.throws(() => validateCompiledTransport(input));
  }
  const input = await fixture();
  assert.throws(() =>
    validateCompiledTransport({
      ...input,
      mermaid: {
        ...input.mermaid!,
        plans: [{ ...plans[0], code: code + " changed" }],
      },
    }),
  );
});
test("maps are required, exact, bounded and fail closed on missing or ambiguous origins", async () => {
  const input = await fixture(),
    map = JSON.parse(input.sourceMap!);
  for (const sourceMap of [
    undefined,
    "{}",
    JSON.stringify({ ...map, mappings: "?" }),
    JSON.stringify({ ...map, mappings: "g" }),
    JSON.stringify({ ...map, mappings: "" }),
    JSON.stringify({
      ...map,
      sourcesContent: map.sourcesContent.map(() => "forged"),
    }),
  ])
    assert.throws(() => validateCompiledTransport({ ...input, sourceMap }));
});

test("prepared SVG exceptions require exact safe bytes and never grant other SVG or transport contexts", async () => {
  for (const extra of [
    `fetch(${JSON.stringify(svg)});`,
    `globalThis.other={id:'diagram',variants:{light:{svg:${JSON.stringify(svg)}}}};`,
  ]) {
    const input = await fixture(extra);
    assert.throws(() => validateCompiledTransport(input));
  }
  for (const unsafe of [
    "<script>run()</script>",
    "<foreignObject/>",
    '<use href="https://example.invalid/x"/>',
    '<path style="fill:url(https://example.invalid/x)"/>',
  ]) {
    const changed = [
      {
        ...plans[0],
        variants: {
          light: { svg: svg.replace("</svg>", unsafe + "</svg>") },
          dark: { svg },
        },
      },
    ];
    const r = runtime.replace(JSON.stringify(plans), JSON.stringify(changed)),
      input = await fixture("", undefined, r);
    assert.throws(() =>
      validateCompiledTransport({
        ...input,
        mermaid: { ...input.mermaid!, plans: changed },
      }),
    );
  }
});
