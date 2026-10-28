import { it, expect } from "vitest";
import {
  admitRuntimeModuleImports,
  runtimeModuleArgument,
} from "../runtime-module-imports";
const body = `const dyn=(u)=>import(/* @vite-ignore */ u);dyn(['data:text/javascript','export default 1'].join(','));dyn(URL.createObjectURL(new Blob(['export default 1'],{type:'text/javascript'})));`;
it("admits only a closed adapter whose calls construct nonlocal runtime URLs and guards the actual argument", () => {
  const result = admitRuntimeModuleImports(body);
  expect(result).toHaveLength(1);
  expect(result[0]!.replacement).toBe(runtimeModuleArgument("u"));
  const rewritten =
    body.slice(0, result[0]!.argumentStart) +
    result[0]!.replacement +
    body.slice(result[0]!.argumentEnd);
  expect(admitRuntimeModuleImports(rewritten)[0]!.replacement).toBe(
    result[0]!.replacement,
  );
});
it("refuses unresolved relative/bare inputs, escaping or mutated adapters, unknown blob bodies and ambiguous bindings", () => {
  for (const source of [
    'const name="./local.js";import(name);',
    'const dyn=u=>import(u);dyn("./local.js");',
    "const dyn=u=>import(u);dyn(name);",
    'let dyn=u=>import(u);dyn("data:text/javascript,export default 1");',
    'const dyn=u=>import(u);const alias=dyn;alias("data:text/javascript,export default 1");',
    'export const dyn=u=>import(u);dyn("data:text/javascript,export default 1");',
    "const dyn=u=>import(u);dyn(URL.createObjectURL(new Blob([source])));",
    'const dyn=u=>import(u);function other(dyn){dyn("./local.js")}dyn("data:text/javascript,export default 1");',
    'const dyn=u=>import(u);dyn("data:text/javascript,export default 1");dyn(...args);',
  ])
    expect(admitRuntimeModuleImports(source), source).toEqual([]);
});
it("the runtime guard accepts only data/blob strings and rejects local, bare, other schemes and coercible objects", () => {
  const guard = new Function(
    "value",
    "return " + runtimeModuleArgument("value"),
  );
  for (const value of [
    "data:text/javascript,export default 1",
    "blob:https://example.test/id",
  ])
    expect(guard(value)).toBe(value);
  for (const value of [
    "./local.js",
    "/local.js",
    "module-name",
    "https://example.test/x.js",
    "file:///private/x.js",
    { toString: () => "blob:https://example.test/id" },
  ])
    expect(() => guard(value)).toThrow();
});
it("publication planning preserves data/blob adapter execution and still refuses arbitrary dynamic local imports", async () => {
  const { planPublicationBundle } = await import("../plan");
  const html = '<script type="module">' + body + "</script>",
    bundle = { entryPath: "index.html", files: [] };
  const plan = planPublicationBundle(html, bundle);
  expect(plan.dependencies).toEqual([]);
  const saved = plan.rewrite(html, "index.html", new Map());
  expect(saved).toContain(runtimeModuleArgument("u"));
  expect(plan.rewrite(saved, "index.html", new Map())).toBe(saved);
  expect(() =>
    planPublicationBundle(
      '<script type="module">const dyn=u=>import(u);dyn("./local.js")</script>',
      bundle,
    ),
  ).toThrow(/Computed module imports/);
});

it("uses the same closed-adapter proof in the Node-only snapshot helper", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { prepareBundle } =
    await import("../../../skills/artifactbin/scripts/publication-bundle.mjs");
  const root = await mkdtemp(join(tmpdir(), "runtime-module-urls-"));
  try {
    await writeFile(
      join(root, "index.html"),
      '<script type="module">' + body + "</script>",
    );
    const result = await prepareBundle({
      root,
      entry: "index.html",
      server: "https://example.test",
    });
    expect(result.body.publicationBundle.files).toEqual([]);
    expect(result.body.html).toContain(body);
    await writeFile(
      join(root, "index.html"),
      '<script type="module">const dyn=u=>import(u);dyn("./hidden.js")</script>',
    );
    await expect(
      prepareBundle({
        root,
        entry: "index.html",
        server: "https://example.test",
      }),
    ).rejects.toThrow(/Computed module imports/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rewrites a module asset argument without changing or dropping its literal local dependencies", async () => {
  const { planPublicationBundle } = await import("../plan");
  const script = 'import "./child.js";' + body;
  const bundle = {
    entryPath: "index.html",
    files: [
      {
        path: "main.js",
        contentType: "text/javascript",
        base64: Buffer.from(script).toString("base64"),
      },
      {
        path: "child.js",
        contentType: "text/javascript",
        base64: Buffer.from("export const value=1").toString("base64"),
      },
    ],
  };
  const plan = planPublicationBundle(
    '<script type="module" src="./main.js"></script>',
    bundle,
  );
  expect(plan.dependencies.map((file) => file.path)).toEqual([
    "child.js",
    "main.js",
  ]);
  const saved = plan.rewrite(
    script,
    "main.js",
    new Map([["child.js", "/a/CHILD1/raw?v=1"]]),
  );
  expect(saved).toContain('import "/a/CHILD1/raw?v=1"');
  expect(saved).toContain(runtimeModuleArgument("u"));
});

it("ships a self-contained installed parser that admits the same runtime adapter outside the repository", async () => {
  const { readFile, writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { buildPreviewParser } =
    await import("../../skills/preview-assets.server");
  const directory = await mkdtemp(
    join(tmpdir(), "installed-runtime-module-parser-"),
  );
  try {
    const parser = await buildPreviewParser(
      await readFile(
        new URL(
          "../../../skills/artifactbin/scripts/preview-html.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await writeFile(join(directory, "preview-html.mjs"), parser);
    await writeFile(
      join(directory, "probe.mjs"),
      `import{publicationLocalReferences}from'./preview-html.mjs';const html=${JSON.stringify('<script type="module">' + body + "</script>")};if(publicationLocalReferences(html,"text/html").length)throw Error('unexpected dependency');let refused=false;try{publicationLocalReferences('<script type="module">const dyn=u=>import(u);dyn("./local.js")</script>','text/html')}catch{refused=true}if(!refused)throw Error('computed local dependency admitted');console.log('installed-parser-passed');`,
    );
    expect(
      execFileSync(process.execPath, [join(directory, "probe.mjs")], {
        cwd: directory,
        encoding: "utf8",
      }).trim(),
    ).toBe("installed-parser-passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("guards computed module URLs with per-character data:/blob: prefix checks", () => {
  const guard = runtimeModuleArgument("value");
  expect(guard).toContain('$afModuleUrl[0]==="d"&&$afModuleUrl[1]==="a"&&$afModuleUrl[2]==="t"&&$afModuleUrl[3]==="a"&&$afModuleUrl[4]===":"');
  expect(guard).toContain('$afModuleUrl[0]==="b"&&$afModuleUrl[1]==="l"&&$afModuleUrl[2]==="o"&&$afModuleUrl[3]==="b"&&$afModuleUrl[4]===":"');
  const run = new Function("value", `return ${guard}`) as (value: unknown) => unknown;
  expect(run("data:text/javascript,1")).toBe("data:text/javascript,1");
  expect(run("blob:https://x.test/1")).toBe("blob:https://x.test/1");
  for (const value of ["https://x.test/a.js", "./a.js", "DATA:x", 1, null])
    expect(() => run(value)).toThrow(TypeError);
});
