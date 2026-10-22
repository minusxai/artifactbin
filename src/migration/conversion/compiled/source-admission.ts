import {historicalSourceValueDeclaration} from "./historical-bound-value.ts";
import {validateBoundPersonRouting} from "./person-admission.ts";
import {readSlideDeckPlan} from "./slide-deck.ts";
import {prepareAuthorEffects} from "./author/effect-source.ts";
import {admitLocalComponent} from "./component-admission.ts";
import {validCompiledMembersBinding} from "./members-binding.ts";
import type {AdmittedAuthorMountProps} from "./author/prop-contracts.ts";
import {admitAuthorProps} from "./author/props.ts";
import type { PresentationIdentityHost } from "./presentation-kit-contracts.ts";
import { presentationKitComponent } from "./presentation-kit.ts";
import type { CompiledScalarControl } from "./scalar-control-contracts.ts";
import {readLocalReactiveExpression} from "./reactive-source.ts";
import {readLocalIdentityPlan, validIdentityConditions} from "./source-identity-plan.ts";
import { controlLiteral } from "./data-controls.ts";
import type { CompiledDataControl } from "./data-control-contracts.ts";
/** Source capability admission only: never invokes a compiler or evaluates source. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { convertLegacyJsx } from "../index.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import { admitAuthorSource } from "./author/admission.ts";
import {admitCompiledDatasetMutationBindings} from "./dataset-mutation-bindings.ts";
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
  "User SlideDeck Slide Helmet Import Value Query Mutation Question Chart Select Segmented Switch Slider DataTable Column For Number Cell Button Input Textarea Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter Badge Alert AlertTitle AlertDescription Grid GridItem Markdown Icon Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption Separator Skeleton Progress".split(
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
  const commonAttributeIssue = (issue: {code:string;message:string}) => issue.code === "attribute" && ["value", "viz", "options", "columns", "sort", "metrics", "each"].some(name => issue.message === "Dynamic attribute requires an adapter: " + name);
  const genericIssueSupported = (issue: {code:string;message:string}) => commonAttributeIssue(issue) || ["expression", "component", "value", "action-adapter", "reference", "data-adapter"].includes(issue.code);
  if (strict.issues.some(issue => !genericIssueSupported(issue) && !(input.authorPlan && ["attribute", "event"].includes(issue.code)))) return blocked("compiled-capability");
  const author = input.authorPlan;
  if (author) {
    try {
      if (author.mode === "effects") {
        if (author.exports.length || author.mounts.length) throw Error("Effect components refused");
        prepareAuthorEffects(author.script);
      } else {
        if (author.mode !== undefined && author.mode !== "components") throw Error("Unknown author mode");
        admitAuthorSource(author.script);
      }
      if (
        Buffer.byteLength(author.script) > 1024 * 1024 ||
        author.exports.length > 64 ||
        new Set(author.exports).size !== author.exports.length ||
        author.exports.some(name => !/^[A-Z][A-Za-z0-9_]*$/.test(name) || allowed.has(name) || presentationKitComponent(name) !== null) ||
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
  const proofs=input.boundValueColumns??[];
  const people=input.personBindings??[];
  if ((historical&&(proofs.length||people.length)) || !validateBoundPersonRouting(proofs,bindings,people)) return blocked("compiled-person-binding");
  const usedPeople=new Set<string>(),boundValues=new Set<string>();
  const backendLinks = new Map<string, string>();
  if (input.membersBinding) {
    if (historical || !validCompiledMembersBinding(input.membersBinding))
      return blocked("compiled-members-binding");
    backendLinks.set(input.membersBinding.backendNamespace, input.membersBinding.backendHref);
  }
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
  const renderedIdentities = new Set<string>();
  const authorProps: AdmittedAuthorMountProps[] = [];
  let invalid = false;
  const registeredMutations = input.datasetMutations ?? [];
  try {
    if (
      !Array.isArray(registeredMutations) ||
      registeredMutations.length > 64 ||
      registeredMutations.some(
        (b) =>
          !b ||
          !backendLinks.has(b.backendNamespace) ||
          !/^[a-f0-9]{64}$/.test(b.recoveryScope),
      ) ||
      (historical && registeredMutations.length)
    )
      throw Error();
    admitCompiledDatasetMutationBindings(registeredMutations);
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
  const presentationIdentities: PresentationIdentityHost[] = [];
  const scalarControls: CompiledScalarControl[] = [];
  const references = new Set<string>();
  const cellReferences = new Set<string>();
  const loopTables = new Set<string>();
  const loopKeys: {table:string;key:string}[] = [];
  const rowReads: {table:string;field:string}[] = [];
  let slideDeck: import("./slide-deck-contracts.ts").CompiledSlideDeck | undefined;
  let dynamicIdentities: import("./reactive-source-contracts.ts").LocalDynamicIdentityPlan = {regions:[]};
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
    const authorPaths = new Set<string>();
    const authorAttributes = new WeakSet<object>();
    const admitMounts = (node:any,path="root",depth=0):void => {
      if (depth > 128) throw Error("Author mount structure limit");
      if (node.type === "JSXElement" && author?.exports.includes(node.openingElement.name.name)) {
        const admitted = admitAuthorProps(node.openingElement.attributes);
        for (const name of Object.values(admitted.bindings)) references.add(name);
        const component = node.openingElement.name.name;
        if (!admitted.identity || !author.mounts.some(m => m.identity === admitted.identity && m.component === component) || authorProps.some(m => m.identity === admitted.identity)) throw Error("Author mount identity mismatch");
        authorProps.push({...admitted,identity:admitted.identity,component});
        for (const attribute of node.openingElement.attributes) authorAttributes.add(attribute);
        authorPaths.add(path);
      }
      for (const [index,child] of (node.children ?? []).entries()) admitMounts(child,path+"."+index,depth+1);
    };
    admitMounts(tree);
    if (author && authorProps.length !== author.mounts.length) throw Error("Author mount manifest mismatch");
    if (strict.issues.some(issue => !genericIssueSupported(issue) && !(["attribute", "event"].includes(issue.code) && authorPaths.has(issue.path)))) return blocked("compiled-capability");

    const readExpression = (node: any, loopDepth: number, loopTable?: string): boolean => {
      const read = readLocalReactiveExpression(node);
      if (read) {
        if (read.rowFields.length && !loopTable) return false;
        for (const field of read.rowFields) rowReads.push({table:loopTable!,field});
        for (const signal of read.signals) {
          const base = signal.split(".")[0]!;
          references.add(base);
          if (signal.includes(".")) cellReferences.add(base);
        }
        return true;
      }
      if (node.type === "JSXEmptyExpression") return true;
      if (node.type === "ConditionalExpression") return readExpression(node.test, loopDepth, loopTable) && branch(node.consequent, loopDepth, loopTable) && branch(node.alternate, loopDepth, loopTable);
      if (node.type === "LogicalExpression" && node.operator === "&&") return readExpression(node.left, loopDepth, loopTable) && branch(node.right, loopDepth, loopTable);
      return safeExpression(node);
    };
    const branch = (node: any, loopDepth: number, loopTable?: string): boolean => ["JSXElement", "JSXFragment"].includes(node.type) || readExpression(node, loopDepth, loopTable);
    const walk = (node: any, parent?: any, loopDepth = 0, loopTable?: string, ancestors: readonly string[] = []) => {
      let childLoopTable = loopTable;
      if (
        node.type === "JSXExpressionContainer" &&
        !(parent?.type === "JSXAttribute" ? authorAttributes.has(parent) || safeExpression(node.expression) : readExpression(node.expression, loopDepth, loopTable))
      )
        invalid = true;
      if (node.type === "JSXElement") {
        const name = node.openingElement.name.name;
        if (loopTable && !loopDepth && !["Column", "Button", "span", "strong", "em", "b", "i", "small", "code", "br", "p", "div", "a"].includes(name)) invalid = true;
        const component = admitLocalComponent(node, {ancestors, parentTag: parent?.type === "JSXElement" ? parent.openingElement.name.name : undefined, rowTable:loopTable});
        if (component) {
          for (const reference of component.references) references.add(reference);
          for (const binding of component.scalarBindings) scalarBindings.add(binding);
          scalarControls.push(...component.scalarControls);
          dataControls.push(...component.dataControls);
          presentationIdentities.push(...component.presentationIdentityHosts);
          if(component.selectedPerson){
            if(!historical&&!people.some(p=>p.valueName===component.selectedPerson))invalid=true;
            usedPeople.add(component.selectedPerson);
          }
          if (component.descendantScope) {
            childLoopTable = component.descendantScope.table;
            if (component.descendantScope.key !== undefined) loopKeys.push({table:childLoopTable,key:component.descendantScope.key});
          }
        }
        if (
          typeof name !== "string" ||
          ["script", "iframe", "object", "embed"].includes(
            name.toLowerCase(),
          ) ||
          (/^[A-Z]/.test(name) &&
            !allowed.has(name) &&
            !presentationKitComponent(name) &&
            !author?.exports.includes(name))
        )
          invalid = true;
        if (!["Helmet", "Value", "Query", "Import", "Mutation"].includes(name)) {
          const ids = node.openingElement.attributes.filter((a: any) => a.name?.name === "id");
          if (ids.length > 1) invalid = true;
          for (const attribute of ids) {
            try {
              const id = controlLiteral(attribute.value);
              if (typeof id !== "string" || !id || renderedIdentities.has(id)) invalid = true;
              else renderedIdentities.add(id);
            } catch { invalid = true; }
          }
        }
        if (name === "For") {
          const attrs = node.openingElement.attributes;
          const each = attrs.find((a: any) => a.name?.name === "each")?.value?.expression;
          const key = attrs.find((a: any) => a.name?.name === "keyBy")?.value?.value;
          const owner = attrs.find((a: any) => a.name?.name === "id")?.value?.value;
          if (loopDepth || loopTable || each?.type !== "Identifier" || !/^\$[A-Za-z]\w*$/.test(each.name) || typeof key !== "string" || !key || ["constructor", "prototype", "__proto__"].includes(key) || typeof owner !== "string" || !owner) invalid = true;
          else {
            childLoopTable = each.name.slice(1);
            loopTables.add(childLoopTable!);
            loopKeys.push({table:childLoopTable!,key});
          }
        }
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
          )?.value?.value ?? "table";
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
        for (const attr of node.openingElement.attributes) {
          if (authorAttributes.has(attr)) continue;
          if (
            attr.value?.expression?.type === "ArrayExpression" &&
            !(name === "Value" && attr.name?.name === "value") &&
            !(["Select", "Segmented"].includes(name) && attr.name?.name === "options") &&
            !(name === "DataTable" && ["columns", "metrics"].includes(attr.name?.name))
          )
            invalid = true;
          const attrName = attr.name?.name?.toLowerCase();
          if (loopTable && attrName === "args") invalid = true;
          if (loopTable && attrName === "set" && (name !== "Button" || node.openingElement.attributes.some((a:any)=>a.name?.name === "run"))) invalid = true;
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
                ) {
                  const value = prop.value.value;
                  if (value.startsWith("$_row.")) {
                    const field = value.slice(6);
                    if (!loopTable || !/^[A-Za-z_]\w*$/.test(field) || ["constructor", "prototype", "__proto__"].includes(field)) invalid = true;
                    else rowReads.push({table:loopTable,field});
                  } else references.add(value.slice(1));
                }
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
            else {
              const mutation = registeredMutations.find(binding => binding.name === run.slice(1));
              const fields = Object.keys(mutation?.rowParams ?? {});
              if (fields.length && !loopTable) invalid = true;
              if (loopTable) for (const field of fields) rowReads.push({table:loopTable,field});
              mutationRuns.add(run.slice(1));
            }
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
              !(["Select", "Segmented"].includes(name) && attr.name.name === "options"))
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
          const declaration = historical&&node.openingElement.attributes.some((a:any)=>a.name?.name==="source") ? historicalSourceValueDeclaration(node) : sourceValueDeclaration(node,proofs);
          if(node.openingElement.attributes.some((a:any)=>a.name?.name==="source"))boundValues.add(declaration.name);
          expectedDeclarations.push(declaration);
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name.name,
              a.value?.value,
            ]),
          );
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            declarations.has(attrs.name)
          )
            invalid = true;
          declarations.add(attrs.name);
          if (declaration.type === "table") tableNames.add(attrs.name);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "start" || key === "end") continue;
        if (Array.isArray(value))
          value.forEach((v) => {
            if (v && typeof v === "object") walk(v, node, loopDepth + (node.type === "JSXElement" && node.openingElement.name.name === "For" ? 1 : 0), childLoopTable, node.type === "JSXElement" ? [...ancestors,node.openingElement.name.name] : ancestors);
          });
        else if (value && typeof value === "object") walk(value, node, loopDepth + (node.type === "JSXElement" && node.openingElement.name.name === "For" ? 1 : 0), childLoopTable, node.type === "JSXElement" ? [...ancestors,node.openingElement.name.name] : ancestors);
      }
    };
    walk(tree);
    if(historical&&[...usedPeople].some(name=>!boundValues.has(name)))invalid=true;
    if(proofs.some(p=>!boundValues.has(p.valueName))||people.some(p=>!usedPeople.has(p.valueName)||expectedDeclarations.find(d=>d.name===p.valueName)?.type!=="user"))invalid=true;
    if (scalarControls.some(control => expectedDeclarations.find(d => d.name === control.binding)?.type !== control.valueType)) invalid = true;
    slideDeck = readSlideDeckPlan(tree);
    dynamicIdentities = readLocalIdentityPlan(tree);
    if (!validIdentityConditions(dynamicIdentities, expectedDeclarations)) invalid = true;
    for (const reference of [...loopKeys.map(r => ({table:r.table,field:r.key})), ...rowReads]) {
      const declaration = expectedDeclarations.find(d => d.name === reference.table);
      if (declaration?.type === "table" && !declaration.columns.some(c => c.name === reference.field)) invalid = true;
    }
    if ([...cellReferences].some(n => !queries.has(n) && !tableNames.has(n)) || [...loopTables].some(n => !queries.has(n) && !tableNames.has(n))) invalid = true;
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
    (historical && imports.size === 0 && queries.size === 0 && boundValues.size === 0) ||
    [...imports].some((n) => declarations.has(n) || queries.has(n))
  )
    invalid = true;
  if (invalid || (declarations.size === 0 && queries.size === 0 && !author && !slideDeck))
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
  input = { ...input, slideDeck, dataControls, dynamicIdentities, presentationIdentities };
  return {
    ok: true,
    plan: {
      input,
      manifest: { declarations: expectedDeclarations },
      renderedIdentities,
      dynamicIdentities,
      historical,
      backendLinks,
      queryNames: queries,
      datasetNames: imports,
      mutationNames: mutations,
      chartCount,
      vegaCount,
      author,
      authorProps,
    },
  };
};
