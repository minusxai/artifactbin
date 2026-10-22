import { admitDataControl, controlLiteral } from "./data-controls.ts";
import type { CompiledDataControl } from "./data-control-contracts.ts";
/** Source capability admission only: never invokes a compiler or evaluates source. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { convertLegacyJsx } from "../index.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import { admitAuthorSource } from "./author/admission.ts";
import {
  createCompiledDatasetMutations,
  compiledDatasetMutationDocument,
} from "./dataset-mutations.ts";
import { parse as parseGraphql } from "graphql";
import { validDatasetBinding } from "./dataset-reader.ts";
import { sourceValueDeclaration } from "./source-manifest.ts";
import type { LocalDeclaration } from "./local-contracts.ts";
import type {
  AdmitLocalSource,
  LocalSourceAdmission,
} from "./source-admission-contracts.ts";
const blocked = (code: string): LocalSourceAdmission => ({ ok: false, code });
const activeUri = (v: string) =>
  /^(javascript|vbscript|blob|data):/.test(
    v.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase(),
  );
const allowed = new Set(
  "Helmet Import Value Query Mutation Question Chart Select DataTable Number Cell Button Input Textarea Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter Badge Alert AlertTitle AlertDescription Grid GridItem Markdown Icon Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption Separator Skeleton Progress".split(
    " ",
  ),
);
export const admitLocalSource: AdmitLocalSource = (input) => {
  try {
    const url = new URL(input.coreUrl, "https://example.invalid");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname != "/af/v1/core.js" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return blocked("compiled-core");
  } catch {
    return blocked("compiled-core");
  }
  if (Buffer.byteLength(input.source) > MAX_COMPILED_SOURCE_BYTES)
    return blocked("compiled-limit");
  const strict = convertLegacyJsx(input);
  if (
    strict.issues.some(
      (i) =>
        !(
          i.code === "attribute" &&
          [
            "Dynamic attribute requires an adapter: value",
            "Dynamic attribute requires an adapter: viz",
            "Dynamic attribute requires an adapter: options",
            "Dynamic attribute requires an adapter: columns",
            "Dynamic attribute requires an adapter: sort",
          ].includes(i.message)
        ) &&
        ![
          "component",
          "value",
          "action-adapter",
          "reference",
          "data-adapter",
        ].includes(i.code),
    )
  )
    return blocked("compiled-capability");
  const author = input.authorPlan;
  if (author) {
    try {
      admitAuthorSource(author.script);
      if (
        Buffer.byteLength(author.script) > 1024 * 1024 ||
        author.exports.length > 64 ||
        author.mounts.length > 256
      )
        return blocked("compiled-author-limit");
    } catch {
      return blocked("compiled-author-capability");
    }
  }
  const historical =
    input.datasetUnavailable?.reason === "historical-binding-unavailable";
  if (input.datasetUnavailable && !historical)
    return blocked("compiled-dataset-unavailable-mode");
  const bindings = input.datasetBindings ?? [];
  if (historical && bindings.length)
    return blocked("compiled-dataset-unavailable-mode");
  const backendLinks = new Map<string, string>();
  if (
    !Array.isArray(bindings) ||
    bindings.some((b) => !b) ||
    bindings.length > 16 ||
    new Set(bindings.map((b) => b.name)).size !== bindings.length ||
    bindings.some(
      (b) =>
        !validDatasetBinding(b) ||
        !/^ref:[A-Za-z0-9]{6,12}$/.test(b.legacyRef) ||
        ["compiledPage", "authorSignals", "datasetMutationIntents"].includes(
          b.backendNamespace,
        ),
    )
  )
    return blocked("compiled-dataset-binding");
  for (const b of bindings) {
    if (
      backendLinks.has(b.backendNamespace) &&
      backendLinks.get(b.backendNamespace) !== b.backendHref
    )
      return blocked("compiled-dataset-binding");
    backendLinks.set(b.backendNamespace, b.backendHref);
  }
  const expectedDeclarations: LocalDeclaration[] = [];
  let invalid = false;
  const registeredMutations = input.datasetMutations ?? [];
  try {
    if (
      !Array.isArray(registeredMutations) ||
      registeredMutations.length > 64 ||
      registeredMutations.some(
        (b) => !b || !backendLinks.has(b.backendNamespace),
      ) ||
      (historical && registeredMutations.length)
    )
      throw Error();
    createCompiledDatasetMutations({
      bindings: registeredMutations,
      client: {
        mutate: async () => {
          throw Error();
        },
      },
      documents: Object.fromEntries(
        registeredMutations.map((b) => [
          b.backendNamespace,
          parseGraphql(compiledDatasetMutationDocument(b.backendNamespace)),
        ]),
      ),
      requestId: () => "",
      values: () => ({}),
      reset: () => {},
      committed: () => {},
    });
  } catch {
    return blocked("compiled-mutation-binding");
  }
  const mutations = new Set<string>();
  const mutationRuns = new Set<string>();
  let chartCount = 0,
    vegaCount = 0;
  const imports = new Set<string>();
  const declarations = new Set<string>();
  const tableNames = new Set<string>();
  const dataControls: CompiledDataControl[] = [];
  const scalarBindings = new Set<string>();
  const references = new Set<string>();
  const queries = new Set<string>();
  const safeExpression = (node: any): boolean => {
    if (node.type === "Literal")
      return (
        node.value === null ||
        ["string", "number", "boolean"].includes(typeof node.value)
      );
    if (
      node.type === "Identifier" &&
      /^\$[A-Za-z][A-Za-z0-9_]*$/.test(node.name)
    ) {
      references.add(node.name.slice(1));
      return true;
    }
    if (node.type === "TemplateLiteral") return node.expressions.length === 0;
    if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator))
      return (
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      );
    if (node.type === "ArrayExpression")
      return node.elements.every((v: any) => v && safeExpression(v));
    if (node.type === "ObjectExpression")
      return node.properties.every(
        (p: any) =>
          p.type === "Property" &&
          !p.computed &&
          !p.method &&
          p.kind === "init" &&
          !["__proto__", "constructor", "prototype"].includes(
            p.key.name ?? p.key.value,
          ) &&
          safeExpression(p.value),
      );
    return false;
  };
  try {
    const text = "<>" + input.source + "</>";
    const tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
    if (tree.end !== text.length) return blocked("compiled-source");
    const walk = (node: any) => {
      if (
        node.type === "JSXExpressionContainer" &&
        !safeExpression(node.expression)
      )
        invalid = true;
      if (node.type === "JSXElement") {
        const name = node.openingElement.name.name;
        if (
          typeof name !== "string" ||
          ["script", "iframe", "object", "embed"].includes(
            name.toLowerCase(),
          ) ||
          (/^[A-Z]/.test(name) &&
            !allowed.has(name) &&
            !author?.exports.includes(name))
        )
          invalid = true;
        if (["Question", "Chart"].includes(name)) {
          chartCount++;
          const attrs = node.openingElement.attributes;
          const data = attrs.find((a: any) => a.name?.name === "data");
          const viz = attrs.find((a: any) => a.name?.name === "viz");
          if (
            !viz ||
            !data ||
            typeof data.value?.value !== "string" ||
            !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(data.value.value)
          )
            invalid = true;
          const kind = viz?.value?.expression?.properties?.find(
            (p: any) => (p.key?.name ?? p.key?.value) === "kind",
          )?.value?.value;
          if (!["table", "single_value"].includes(kind)) vegaCount++;
        }
        if (name === "Import") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name?.name,
              a.value?.value,
            ]),
          );
          const binding = bindings.find(
            (b) => b.name === attrs.name && b.legacyRef === attrs.src,
          );
          if (
            (!historical && !binding) ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            !/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.src) ||
            imports.has(attrs.name) ||
            node.openingElement.attributes.length !== 2 ||
            Object.keys(attrs).some((k) => !["name", "src"].includes(k)) ||
            node.children.some(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            )
          )
            invalid = true;
          imports.add(attrs.name);
        }
        if (name === "Select" || name === "DataTable") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => {
              if (a.type !== "JSXAttribute" || typeof a.name?.name !== "string")
                throw Error("Invalid control attribute");
              return [a.name.name, controlLiteral(a.value)];
            }),
          );
          const plan = admitDataControl(
            name,
            attrs,
            node.children.some(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            ),
          );
          dataControls.push(plan);
          if (plan.kind === "select") {
            references.add(plan.value);
            scalarBindings.add(plan.value);
            if (typeof plan.options === "string") references.add(plan.options);
          } else references.add(plan.data);
        }
        for (const attr of node.openingElement.attributes) {
          if (
            attr.value?.expression?.type === "ArrayExpression" &&
            !(name === "Value" && attr.name?.name === "value") &&
            !(name === "Select" && attr.name?.name === "options") &&
            !(name === "DataTable" && attr.name?.name === "columns")
          )
            invalid = true;
          const attrName = attr.name?.name?.toLowerCase();
          if (
            attrName === "data-migration-dataset-status" ||
            attrName?.startsWith("data-migration-author-") ||
            (author?.exports.includes(name) &&
              ["constructor", "prototype", "__proto__"].includes(attrName))
          )
            invalid = true;
          const attrValue = attr.value?.value ?? attr.value?.expression?.value;
          if (
            author?.exports.includes(name) &&
            typeof attrValue === "string" &&
            /^\$[A-Za-z][A-Za-z0-9_]*$/.test(attrValue)
          )
            references.add(attrValue.slice(1));
          if (
            /^on/.test(attrName) ||
            attrName === "srcdoc" ||
            (["href", "src", "action", "formaction", "xlink:href"].includes(
              attrName,
            ) &&
              typeof attrValue === "string" &&
              activeUri(attrValue))
          )
            invalid = true;
          if (
            attr.type === "JSXAttribute" &&
            ["value", "checked", "data"].includes(attr.name.name) &&
            typeof attr.value?.value === "string" &&
            attr.value.value.startsWith("$")
          ) {
            references.add(attr.value.value.slice(1));
            if (
              ["Input", "Textarea", "input", "textarea", "select"].includes(
                name,
              )
            )
              scalarBindings.add(attr.value.value.slice(1));
          }
          if (attr.type === "JSXAttribute" && attr.name.name === "set") {
            const object = attr.value?.expression;
            if (object?.type !== "ObjectExpression") invalid = true;
            else
              for (const prop of object.properties) {
                references.add(prop.key?.name ?? prop.key?.value);
                scalarBindings.add(prop.key?.name ?? prop.key?.value);
                if (
                  typeof prop.value?.value === "string" &&
                  prop.value.value.startsWith("$")
                )
                  references.add(prop.value.value.slice(1));
              }
          }
          if (attr.name?.name === "run") {
            const run = attr.value?.value;
            if (
              name !== "Button" ||
              typeof run !== "string" ||
              !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(run)
            )
              invalid = true;
            else mutationRuns.add(run.slice(1));
          }
          if (attr.name?.name === "args") {
            if (
              name !== "Button" ||
              attr.value?.expression?.type !== "ObjectExpression"
            )
              invalid = true;
            else
              for (const prop of attr.value.expression.properties) {
                const value = prop.value?.value;
                if (typeof value === "string" && value.startsWith("$"))
                  references.add(value.slice(1));
              }
          }
          if (
            attr.type !== "JSXAttribute" ||
            typeof attr.name.name !== "string" ||
            (["row", "rowScope", "options", "query", "table"].includes(
              attr.name.name,
            ) &&
              !(name === "Select" && attr.name.name === "options"))
          )
            invalid = true;
        }
        if (name === "Mutation") {
          const attributes = node.openingElement.attributes;
          if (
            new Set(attributes.map((a: any) => a.name?.name)).size !==
            attributes.length
          )
            invalid = true;
          const expected = attributes.find(
            (a: any) => a.name?.name === "expectedAffected",
          );
          if (expected) {
            const literal =
              expected.value?.type === "JSXExpressionContainer"
                ? expected.value.expression
                : expected.value;
            // The publication extractor owns this authority field. Admission
            // accepts its exact literal grammar; browser routing gains no flag.
            if (
              literal?.type !== "Literal" ||
              typeof literal.value !== "number" ||
              !Number.isSafeInteger(literal.value) ||
              literal.value < 0
            )
              invalid = true;
          }
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name?.name,
              a.value?.value,
            ]),
          );
          if (
            (!historical &&
              !registeredMutations.some((b) => b.name === attrs.name)) ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            mutations.has(attrs.name) ||
            Object.keys(attrs).some(
              (k) => !["id", "name", "reset", "expectedAffected"].includes(k),
            )
          )
            invalid = true;
          const metadata = registeredMutations.find(
            (b) => b.name === attrs.name,
          );
          const reset =
            typeof attrs.reset === "string"
              ? attrs.reset.trim().split(/\s+/).filter(Boolean)
              : [];
          if (
            (attrs.reset !== undefined && typeof attrs.reset !== "string") ||
            (!historical &&
              JSON.stringify(reset) !== JSON.stringify(metadata?.reset ?? []))
          )
            invalid = true;
          const payload = node.children.filter(
            (c: any) => c.type !== "JSXText" || c.value.trim(),
          );
          if (
            payload.length !== 1 ||
            !(
              payload[0]?.type === "JSXText" ||
              (payload[0]?.type === "JSXExpressionContainer" &&
                (typeof payload[0].expression?.value === "string" ||
                  (payload[0].expression?.type === "TemplateLiteral" &&
                    !payload[0].expression.expressions.length)))
            )
          )
            invalid = true;
          mutations.add(attrs.name);
        }
        if (name === "Query") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name.name,
              a.value?.value,
            ]),
          );
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            Object.keys(attrs).some((k) => !["id", "name"].includes(k)) ||
            queries.has(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name)
          )
            invalid = true;
          queries.add(attrs.name);
        }
        if (name === "Value") {
          expectedDeclarations.push(sourceValueDeclaration(node));
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name.name,
              a.value?.value,
            ]),
          );
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            declarations.has(attrs.name) ||
            !["string", "number", "boolean", "table"].includes(attrs.type)
          )
            invalid = true;
          declarations.add(attrs.name);
          if (attrs.type === "table") tableNames.add(attrs.name);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "start" || key === "end") continue;
        if (Array.isArray(value))
          value.forEach((v) => {
            if (v && typeof v === "object") walk(v);
          });
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(tree);
    if (
      [...references].some(
        (name) => !declarations.has(name) && !queries.has(name),
      )
    )
      invalid = true;
  } catch {
    return blocked("compiled-source");
  }
  if (
    (!historical && registeredMutations.length !== mutations.size) ||
    [...mutations].some(
      (n) => declarations.has(n) || queries.has(n) || imports.has(n),
    ) ||
    [...mutationRuns].some((n) => !mutations.has(n)) ||
    registeredMutations.some((b) =>
      b.reset?.some((n: string) => !declarations.has(n) || tableNames.has(n)),
    )
  )
    invalid = true;
  if (
    [...queries].some((q) => declarations.has(q)) ||
    [...scalarBindings].some((n) => tableNames.has(n))
  )
    invalid = true;
  if (
    (!historical && imports.size !== bindings.length) ||
    (historical && imports.size === 0) ||
    [...imports].some((n) => declarations.has(n) || queries.has(n))
  )
    invalid = true;
  if (invalid || (declarations.size === 0 && queries.size === 0 && !author))
    return blocked("compiled-capability");
  if (
    dataControls.some((p) =>
      p.kind === "select"
        ? !declarations.has(p.value) ||
          tableNames.has(p.value) ||
          (typeof p.options === "string" &&
            !queries.has(p.options) &&
            !tableNames.has(p.options))
        : !queries.has(p.data) && !tableNames.has(p.data),
    )
  )
    return blocked("compiled-data-control");
  input = { ...input, dataControls };
  return {
    ok: true,
    plan: {
      input,
      manifest: { declarations: expectedDeclarations },
      historical,
      backendLinks,
      queryNames: queries,
      datasetNames: imports,
      mutationNames: mutations,
      chartCount,
      vegaCount,
      author,
    },
  };
};
