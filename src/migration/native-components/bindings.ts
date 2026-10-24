/** Offline translation of retained typed bindings into ordinary author JavaScript. */
import { parseExpressionAt } from "acorn";
import { parse as parseGraphql, Kind } from "graphql";
import { readLocalReactiveExpression } from "../conversion/compiled/reactive-source.ts";
import { evaluateLocalReactiveExpression } from "../conversion/compiled/dynamic-identities.ts";
import type { LocalReactiveExpression } from "../conversion/compiled/reactive-source-contracts.ts";
import type {
  NativeJson,
  RetainedJsxNode,
  RetainedStaticValue,
} from "./analyze-contracts.ts";
import type {
  NativeBindingsInput,
  NativeBindingsResult,
  NativeBindingBlocker,
  NativeControlWriteback,
} from "./bindings-contracts.ts";
import { normalizeTimestamp } from "../../datasets/timestamp.ts";
import {nativePersonProjection} from "./person-runtime.ts";
import { NATIVE_BINDINGS_RUNTIME } from "./bindings-runtime.ts";
import { nativeTableTarget } from "./table-columns.ts";
import { nativeDigest } from "./selection.ts";
const name = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z_]\w*$/.test(value) &&
  !["__proto__", "prototype", "constructor"].includes(value);
/** Convert the retained serialized read tree back to the existing parser input;
 * the archived parser is the sole grammar admission authority. */
function reactive(value: any, depth = 0): LocalReactiveExpression | null {
  if (!value || depth > 32) return null;
  const ast = (node: any, level = 0): any => {
    if (!node || level > 32) return null;
    switch (node.kind) {
      case "literal":
        return { type: "Literal", value: node.value };
      case "signal": {
        if (typeof node.name !== "string") return null;
        const parts = node.name.split(".");
        if (parts.length > 2) return null;
        return parts.length === 1
          ? { type: "Identifier", name: "$" + parts[0] }
          : {
              type: "MemberExpression",
              computed: false,
              object: { type: "Identifier", name: "$" + parts[0] },
              property: { type: "Identifier", name: parts[1] },
            };
      }
      case "row":
        return {
          type: "MemberExpression",
          computed: false,
          object: { type: "Identifier", name: "$_row" },
          property: { type: "Identifier", name: node.field },
        };
      case "not":
        return {
          type: "UnaryExpression",
          operator: "!",
          argument: ast(node.value, level + 1),
        };
      case "binary":
        return {
          type: "BinaryExpression",
          operator: node.op,
          left: ast(node.left, level + 1),
          right: ast(node.right, level + 1),
        };
      default:
        return null;
    }
  };
  return readLocalReactiveExpression(ast(value))?.expression ?? null;
}
function expression(
  value: RetainedStaticValue,
): LocalReactiveExpression | null {
  if (value.static)
    return value.json === null ||
      ["string", "boolean", "number"].includes(typeof value.json)
      ? {
          kind: "literal",
          value: value.json as string | boolean | number | null,
        }
      : null;
  if (value.reactive) return reactive(value.reactive);
  try {
    const tree = parseExpressionAt(value.source, 0, { ecmaVersion: "latest" });
    if (value.source.slice(tree.end).trim()) return null;
    return readLocalReactiveExpression(tree)?.expression ?? null;
  } catch {
    return null;
  }
}
function signals(expr: LocalReactiveExpression): string[] {
  return expr.kind === "signal"
    ? [expr.name]
    : expr.kind === "not"
      ? signals(expr.value)
      : expr.kind === "binary"
        ? [...signals(expr.left), ...signals(expr.right)]
        : [];
}
const escapedJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
export function emitNativeBindings(
  input: NativeBindingsInput,
): NativeBindingsResult {
  const blockers: NativeBindingBlocker[] = [],
    defaults: Record<string, NativeJson> = Object.create(null),
    valueTypes: Record<string, string> = Object.create(null),
    nodes = new Map<string, RetainedJsxNode>();
  const block = (sourceNode: string, code: string) =>
    blockers.push({ sourceNode, code });
  const walk = (node: RetainedJsxNode) => {
    if (nodes.has(node.graphKey)) block(node.graphKey, "duplicate-source-node");
    nodes.set(node.graphKey, node);
    if (node.type === "element") node.children.forEach(walk);
  };
  input.analysis.nodes.forEach(walk);
  for (const value of input.analysis.flow.values) {
    const type = typeof value.type === "string" ? value.type : "";
    const primitive =
      type === "number"
        ? "number"
        : type === "boolean"
          ? "boolean"
          : ["string", "date", "timestamp", "user"].includes(type)
            ? "string"
            : null;
    const initial = value.default ?? null;
    if (
      !name(value.name) ||
      Object.hasOwn(defaults, value.name) ||
      !primitive ||
      (initial !== null && typeof initial !== primitive) ||
      (typeof initial === "number" && !Number.isFinite(initial))
    )
      block("$values", "invalid-local-value");
    else {
      defaults[value.name] = initial;
      valueTypes[value.name] = primitive;
    }
  }
  const queryNames = new Set(
      input.analysis.flow.queries.map((query) => query.name),
    ),
    mutationNames = new Set(
      input.analysis.flow.mutations.map((mutation) => mutation.name),
    );
  if (
    new Set(input.queries.map((query) => query.name)).size !==
      input.queries.length ||
    new Set(input.mutations.map((mutation) => mutation.name)).size !==
      input.mutations.length
  )
    block("$operations", "duplicate-operation-descriptor");
  const validateDocument = (
    descriptor: { document: string; namespace: string },
    operation: "query" | "mutation",
  ) => {
    try {
      const parsed = parseGraphql(descriptor.document);
      const definitions = parsed.definitions;
      if (
        definitions.length !== 1 ||
        definitions[0]?.kind !== Kind.OPERATION_DEFINITION ||
        definitions[0].operation !== operation
      )
        return false;
      const selections = definitions[0].selectionSet.selections;
      const field = selections[0];
      const operationField =
        field?.kind === Kind.FIELD
          ? field.selectionSet?.selections[0]
          : undefined;
      if (
        field?.kind !== Kind.FIELD ||
        field.selectionSet?.selections.length !== 1 ||
        operationField?.kind !== Kind.FIELD ||
        operationField.alias ||
        operationField.name.value !==
          (operation === "query" ? "evaluate" : "run") ||
        operationField.arguments?.some(
          (argument) =>
            argument.value.kind !== Kind.VARIABLE ||
            ![
              "values",
              ...(operation === "query" ? ["only"] : ["requestId"]),
            ].includes(argument.name.value),
        )
      )
        return false;
      return (
        selections.length === 1 &&
        selections[0]?.kind === Kind.FIELD &&
        selections[0].name.value === descriptor.namespace &&
        !selections[0].alias
      );
    } catch {
      return false;
    }
  };
  if(input.people&&(!name(input.people.namespace)||input.people.authority!=="linked-dataset-typed-user-v1"||!/^ref:[A-Za-z0-9_-]+$/.test(input.people.datasetRef)||input.people.mode!=="live"))block("$people","invalid-people-descriptor");
  if (input.viewer) {
    const viewer=input.viewer;
    try {
      const document=parseGraphql(viewer.document),definition=document.definitions[0];
      const root=definition?.kind===Kind.OPERATION_DEFINITION?definition.selectionSet.selections[0]:undefined;
      const field=root?.kind===Kind.FIELD?root.selectionSet?.selections[0]:undefined;
      const id=field?.kind===Kind.FIELD?field.selectionSet?.selections[0]:undefined;
      if(viewer.identity!=="target-subject-v1"||!name(viewer.namespace)||viewer.responsePath.join('.')!==[viewer.namespace,'viewer','id'].join('.')||
        document.definitions.length!==1||definition?.kind!==Kind.OPERATION_DEFINITION||definition.operation!=="query"||definition.variableDefinitions?.length||definition.directives?.length||definition.selectionSet.selections.length!==1||
        root?.kind!==Kind.FIELD||root.alias||root.name.value!==viewer.namespace||root.arguments?.length||root.directives?.length||root.selectionSet?.selections.length!==1||
        field?.kind!==Kind.FIELD||field.alias||field.name.value!=="viewer"||field.arguments?.length||field.directives?.length||field.selectionSet?.selections.length!==1||
        id?.kind!==Kind.FIELD||id.alias||id.name.value!=="id"||id.arguments?.length||id.directives?.length||id.selectionSet)block('$viewer','invalid-viewer-descriptor');
    }catch{block('$viewer','invalid-viewer-descriptor');}
  }
  for (const query of input.queries)
    if (
      !name(query.name) ||
      !queryNames.has(query.name) ||
      !name(query.namespace) ||
      Object.hasOwn(defaults, query.namespace) ||
      query.decode !== "registered-page-table-cells-v1" ||
      query.tableName !== query.name ||
      !validateDocument(query, "query") ||
      query.responsePath.join(".") !==
        [query.namespace, "evaluate", "tables"].join(".") ||
      query.values.some((field) => !Object.hasOwn(defaults, field.name))
    )
      block(query.name, "invalid-query-descriptor");
  for (const mutation of input.mutations) {
    if (mutation.mode === "historical-readonly") {
      if (!name(mutation.name) || !mutationNames.has(mutation.name) || Object.keys(mutation).some(key => !["name", "mode"].includes(key))) block(mutation.name, "invalid-readonly-mutation-descriptor");
      continue;
    }
    if (
      !name(mutation.name) ||
      !mutationNames.has(mutation.name) ||
      !name(mutation.namespace) ||
      Object.hasOwn(defaults, mutation.namespace) ||
      !validateDocument(mutation, "mutation") ||
      mutation.outcomePath.join(".") !==
        [mutation.namespace, "run"].join(".") ||
      mutation.values.some((field) => field.source
        ? field.source.kind !== "row" || !name(field.name) || !name(field.source.field) || !["string", "number", "boolean"].includes(field.type)
        : !Object.hasOwn(defaults, field.name)) ||
      mutation.reset.some((field) => !Object.hasOwn(defaults, field))
    )
      block(mutation.name, "invalid-mutation-descriptor");
  }
  const targets: any[] = [];
  const admit = (expr: LocalReactiveExpression | null, sourceNode: string) => {
    if (!expr) {
      block(sourceNode, "unsupported-expression");
      return null;
    }
    if (
      signals(expr).some(
        (signal) =>
          !(signal === "_me.id" && input.viewer) &&
          !Object.hasOwn(defaults, signal) &&
          !input.queries.some((query) => query.name === signal),
      )
    )
      block(sourceNode, "unregistered-expression-binding");
    return expr;
  };
  for (const target of input.targets) {
    const node = nodes.get(target.sourceNode);
    if (!node || !target.afId) {
      block(target.sourceNode, "missing-target-identity");
      continue;
    }
    if (
      (target.analysisSha256 !== undefined &&
        target.analysisSha256 !== input.analysis.analysisSha256) ||
      (target.sourceSha256 !== undefined &&
        target.sourceSha256 !== input.analysis.sourceSha256) ||
      (target.proofSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(target.proofSha256))
    )
      block(target.sourceNode, "target-identity-proof-mismatch");
    const result: any = { ...target };
    if (target.kind === "text") {
      if (node.type !== "expression") {
        block(node.graphKey, "invalid-text-target");
        continue;
      }
      result.expression = admit(expression(node.value), node.graphKey);
    } else if(target.kind==="person") {
      if(node.type!=="element"||node.tag!=="User"||node.children.length||!input.people){block(target.sourceNode,"invalid-person-target");continue;}
      const value=node.attributes.find(attr=>attr.name==="userId")?.value;
      result.expression=admit(value?.static&&typeof value.json==="string"&&value.json.startsWith("$")?expression({static:false,exprType:"reference",source:value.json}):value?expression(value):null,node.graphKey);
    } else if (target.kind === "cell") {
      if(node.type!=="element"||!["Cell","Number"].includes(node.tag)||target.attribute!=="data") {block(target.sourceNode,"invalid-cell-target");continue;}
      const attrs=new Map(node.attributes.map(attr=>[attr.name,attr.value]));
      const data=attrs.get("data");
      result.expression=admit(data?.static&&typeof data.json==="string"&&data.json.startsWith("$")?expression({static:false,exprType:"reference",source:data.json}):data?expression(data):null,node.graphKey);
      if(result.expression?.kind!=="signal"||!queryNames.has(result.expression.name))block(node.graphKey,"cell-target-needs-declared-query");
      result.format={};
      for(const property of ["col","agg","format","prefix","suffix"]){const value=attrs.get(property);if(value===undefined)continue;if(!value.static||typeof value.json!=="string"&&value.json!==null){block(node.graphKey,"invalid-cell-format-property");continue;}if(value.json!==null)result.format[property]=value.json;}
      if(result.format.agg!==undefined&&!["first","last","sum","avg","median","min","max","count"].includes(result.format.agg))block(node.graphKey,"invalid-cell-aggregate");
      const className=attrs.get("className")??attrs.get("class");
      if(className&&(!className.static||typeof className.json!=="string"))block(node.graphKey,"invalid-cell-class");
      result.authorClass=className?.static?className.json:null;
      if(!input.cellAdapter||!/^\.\/components\/[A-Za-z0-9_.-]+\.js$/.test(input.cellAdapter.specifier)||!/^[a-f0-9]{64}$/.test(input.cellAdapter.sha256))block(node.graphKey,"cell-formatter-adapter-required");
    } else if (target.kind === "property") {
      if (node.type !== "element") {
        block(node.graphKey, "invalid-property-target");
        continue;
      }
      const attr = node.attributes.find(
        (attr) => attr.name === target.attribute,
      );
      if (
        !["disabled", "checked", "value", "open", "data", "options"].includes(
          target.property,
        )
      )
        block(node.graphKey, "unsupported-bound-property");
      const value = attr?.value;
      result.expression = admit(
        value?.static &&
          typeof value.json === "string" &&
          value.json.startsWith("$")
          ? expression({
              static: false,
              exprType: "reference",
              source: value.json,
            })
          : value
            ? expression(value)
            : null,
        node.graphKey,
      );
      if (
        target.property === "data" &&
        (target.attribute !== "data" ||
          result.expression?.kind !== "signal" ||
          !queryNames.has(result.expression.name))
      )
        block(node.graphKey, "data-target-needs-declared-query");
      if(target.property==="options"&&(node.tag!=="Select"||target.attribute!=="options"||result.expression?.kind!=="signal"||!queryNames.has(result.expression.name)))block(node.graphKey,"options-target-needs-declared-query");
      const custom = {
        Input: "value",
        Textarea: "value",
        Select: "value",
        Slider: "value",
        Switch: "checked",
        Segmented: "value",
        DatePicker: "value",
        Dialog: "open",
      } as Record<string, string>;
      const isNative = ["input", "textarea", "select"].includes(node.tag);
      const isControl =
        custom[node.tag] === target.property ||
        (isNative && ["value", "checked"].includes(target.property));
      if (isControl) {
        const read = result.expression as LocalReactiveExpression | null;
        const declaration =
          read?.kind === "signal"
            ? input.analysis.flow.values.find(
                (value) => value.name === read.name,
              )
            : undefined;
        if (!declaration || read?.kind !== "signal")
          block(node.graphKey, "nonassignable-control-binding");
        else {
          if (node.tag === "Dialog" && declaration.type !== "boolean")
            block(node.graphKey, "dialog-needs-boolean-binding");
          const multiple =
            node.tag === "Select" &&
            node.attributes.some(
              (attr) =>
                attr.name === "multiple" &&
                attr.value.static &&
                attr.value.json === true,
            ) &&
            declaration.type !== "user";
          if (multiple && declaration.type !== "string")
            block(node.graphKey, "multiple-control-needs-string-binding");
          const writeback: NativeControlWriteback = {
            event: isNative
              ? node.tag === "select" || target.property === "checked"
                ? "change"
                : "input"
              : "af-change",
            source: isNative
              ? target.property === "checked"
                ? "target.checked"
                : "target.value"
              : "detail.value",
            valueName: read.name,
            scalarType: declaration.type as string,
            multiple,
          };
          result.writeback = writeback;
        }
      }
    } else if (target.kind === "condition") {
      if (
        node.type !== "element" ||
        !node.control ||
        typeof node.control !== "object" ||
        Array.isArray(node.control) ||
        (node.control as any).kind !== "and" ||
        !target.templateId
      ) {
        block(node.graphKey, "unsupported-condition");
        continue;
      }
      result.expression = admit(
        reactive((node.control as any).test),
        node.graphKey,
      );
    } else if (target.kind === "loop") {
      if (node.type !== "element" || node.tag !== "For") {
        block(node.graphKey, "invalid-loop-target");
        continue;
      }
      const each = node.attributes.find((attr) => attr.name === "each"),
        key = node.attributes.find((attr) => attr.name === "keyBy"),
        owner = node.attributes.find((attr) => attr.name === "id");
      result.expression = admit(
        each ? expression(each.value) : null,
        node.graphKey,
      );
      if (
        result.expression?.kind !== "signal" ||
        !input.queries.some((query) => query.name === result.expression.name) ||
        !target.templateId ||
        !target.identity ||
        target.identity.encoding !== "archived-instance-v1" ||
        !target.identity.owner ||
        !owner?.value.static ||
        owner.value.json !== target.identity.owner ||
        (target.identity.keyBy === null
          ? key !== undefined
          : typeof target.identity.keyBy !== "string" ||
            !target.identity.keyBy ||
            !key?.value.static ||
            key.value.json !== target.identity.keyBy) ||
        !target.identity.templateIds.length ||
        new Set(target.identity.templateIds).size !==
          target.identity.templateIds.length ||
        target.identity.templateIds.some(
          (id) => typeof id !== "string" || !id,
        ) ||
        (target.identity.domIds ?? []).some(
          (entry) =>
            !entry.domId ||
            /\s/.test(entry.domId) ||
            !target.identity.templateIds.includes(entry.templateAfId),
        ) ||
        new Set((target.identity.domIds ?? []).map((entry) => entry.domId))
          .size !== (target.identity.domIds ?? []).length
      )
        block(node.graphKey, "missing-loop-identity-plan");
    } else if (target.kind === "table") {
      try {
        const proof = nativeTableTarget(node, input.identityBindings ?? []);
        if(!proof || nativeDigest(proof)!==nativeDigest(target))block(node.graphKey,'invalid-table-plan');
      } catch {block(node.graphKey,'invalid-table-plan');}
      const data=node.type==='element'?node.attributes.find(attr=>attr.name==='data')?.value:undefined;
      result.expression=admit(data?.static&&typeof data.json==='string'?expression({static:false,exprType:'reference',source:data.json}):null,node.graphKey);
      if(result.expression?.kind!=='signal'||!queryNames.has(result.expression.name))block(node.graphKey,'table-needs-declared-query');
    } else if (target.kind === "action") {
      if (node.type !== "element" || node.tag !== "Button") {
        block(node.graphKey, "invalid-action-target");
        continue;
      }
      const attrs = new Map(
        node.attributes.map((attr) => [attr.name, attr.value]),
      );
      if (attrs.has("args")) block(node.graphKey, "unsupported-action-args");
      const set = attrs.get("set");
      if (set) {
        if (
          !set.static ||
          !set.json ||
          typeof set.json !== "object" ||
          Array.isArray(set.json)
        )
          block(node.graphKey, "unsupported-action-set");
        else {
          result.set = Object.create(null);
          for (const [key, value] of Object.entries(set.json)) {
            if (!Object.hasOwn(defaults, key)) {
              block(node.graphKey, "undeclared-action-value");
              continue;
            }
            const read =
              typeof value === "string" && value.startsWith("$")
                ? expression({
                    static: false,
                    exprType: "reference",
                    source: value,
                  })
                : expression({ static: true, json: value });
            result.set[key] = admit(read, node.graphKey);
          }
        }
      }
      const run = attrs.get("run");
      if (run) {
        if (
          !run.static ||
          typeof run.json !== "string" ||
          !/^\$[A-Za-z]\w*$/.test(run.json) ||
          !input.mutations.some(
            (mutation) => mutation.name === (run.json as string).slice(1),
          )
        )
          block(node.graphKey, "missing-mutation-descriptor");
        else result.run = run.json.slice(1);
      }
    }
    targets.push(result);
  }
  const hasTarget = (sourceNode: string, kind: string, attribute?: string) =>
    targets.some(
      (target) =>
        target.sourceNode === sourceNode &&
        target.kind === kind &&
        (attribute === undefined || target.attribute === attribute),
    );
  const owners = new Map<string, string>();
  for (const target of targets) {
    const prior = owners.get(target.afId);
    if (prior && prior !== target.sourceNode)
      block(target.sourceNode, "duplicate-target-identity");
    owners.set(target.afId, target.sourceNode);
  }
  for (const node of nodes.values()) {
    if (
      node.type === "expression" &&
      !node.value.static &&
      !hasTarget(node.graphKey, "text")
    )
      block(node.graphKey, "missing-expression-target");
    if (node.type !== "element") continue;
    if (
      (node.control as any)?.kind === "and" &&
      !hasTarget(node.graphKey, "condition")
    )
      block(node.graphKey, "missing-condition-target");
    if (node.tag === "For" && !hasTarget(node.graphKey, "loop"))
      block(node.graphKey, "missing-loop-target");
    if (
      node.tag === "Button" &&
      node.attributes.some((attr) => ["set", "run"].includes(attr.name)) &&
      !hasTarget(node.graphKey, "action")
    )
      block(node.graphKey, "missing-action-target");
    for (const attr of node.attributes)
      if (
        !attr.value.static &&
        !(node.tag === "For" && attr.name === "each") &&
        !hasTarget(node.graphKey, "property", attr.name) && !(attr.name==="data"&&hasTarget(node.graphKey,"cell"))
      )
        block(node.graphKey, "missing-property-target");
  }
  for (const target of targets)
    if (
      target.kind === "loop" &&
      targets.some(
        (other) =>
          other.kind === "loop" &&
          target.identity.templateIds.includes(other.afId),
      )
    )
      block(target.sourceNode, "nested-loop-plan-unsupported");
  for (const target of targets) {
    const expr = target.expression;
    const hasRow = (value: LocalReactiveExpression): boolean =>
      value.kind === "row" ||
      (value.kind === "not" && hasRow(value.value)) ||
      (value.kind === "binary" && (hasRow(value.left) || hasRow(value.right)));
    if (expr && signals(expr).includes("_me.id")) target.viewerIdentity = true;
    if (
      expr &&
      hasRow(expr) &&
      !targets.some(
        (loop) =>
          loop.kind === "loop" && loop.identity?.templateIds.includes(target.afId) ||
          loop.kind === "table" && loop.columns.some((column:any)=>column.template?.templateIds.includes(target.afId)),
      )
    )
      block(target.sourceNode, "row-expression-without-loop-plan");
  }
  if (blockers.length)
    return { status: "blocked", authorJs: null, localDefaults: null, blockers };
  const localQuery = Object.keys(defaults).length
    ? "query NativeLocal{" + Object.keys(defaults).join(" ") + "}"
    : null;
  const plan = {
    defaults,
    valueTypes,
    localQuery,
    targets,
    queries: input.queries,
    mutations: input.mutations,
    viewer: input.viewer,
    people:input.people,
  };
  const evaluator = evaluateLocalReactiveExpression.toString();
  const cellImport=targets.some(target=>target.kind==="cell")?`import {formatNativeLiveCell} from ${escapedJson(input.cellAdapter!.specifier)};\n`:"";
  const authorJs = `${cellImport}import {client,gql} from "@afbin/apollo";\nconst own=(record,key)=>record&&Object.hasOwn(record,key)?record[key]??null:null;\nconst DatasetReadError=Error;\nexport const dispose=(${NATIVE_BINDINGS_RUNTIME})(client,gql,document,${escapedJson(plan)},(${evaluator}),(${normalizeTimestamp.toString()}),${targets.some(target=>target.kind==="cell")?"formatNativeLiveCell":"null"},(${nativePersonProjection.toString()}));\ndocument.defaultView?.addEventListener("pagehide",event=>{if(!event.persisted)dispose();});\n`;
  return {
    status: "complete",
    authorJs,
    localDefaults: defaults,
    blockers: [],
  };
}
