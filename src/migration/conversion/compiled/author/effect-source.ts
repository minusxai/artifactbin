import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { admitAuthorSource } from "./admission.ts";
import type { PreparedAuthorEffects } from "./effect-source-contracts.ts";
const parser = Parser.extend(jsx());
const timers: Record<string, string> = {
  setTimeout: "timeout",
  setInterval: "interval",
  clearTimeout: "clearTimer",
  clearInterval: "clearTimer",
  requestAnimationFrame: "frame",
  cancelAnimationFrame: "cancelFrame",
};
const windowFields = new Set([
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
  "scrollX",
  "scrollY",
]);
const windowMethods = new Set([
  "addEventListener",
  "removeEventListener",
  "matchMedia",
]);
const windowEvents = new Set(["resize", "scroll", "hashchange", "pointerup"]);
/** A bounded parsed rewrite. Unknown lifetime forms remain refusals, never best-effort effects. */
export function prepareAuthorEffects(source: string): PreparedAuthorEffects {
  if (Buffer.byteLength(source) > 262_144)
    throw Error("Author effects source limit");
  const ast = parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const identifiers = new Set<string>();
  const collect = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") identifiers.add(node.name);
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") collect(value);
  };
  collect(ast);
  let suffix = 0;
  while (
    identifiers.has("_afLifetime" + suffix) ||
    identifiers.has("_afWindow" + suffix)
  )
    suffix++;
  const lifetimeIdentifier = "_afLifetime" + suffix,
    windowIdentifier = "_afWindow" + suffix;
  const edits = new Map<any, (render: (node: any) => string) => string>();
  let windows = false,
    listeners = false,
    time = false;
  const visit = (node: any, parent?: any, key?: string) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "MemberExpression" &&
      node.computed &&
      !(
        node.property.type === "Literal" &&
        Number.isSafeInteger(node.property.value) &&
        node.property.value >= 0
      )
    )
      throw Error("Only literal numeric effect indexing is supported");
    if (
      node.type === "Identifier" &&
      node.name === "Object" &&
      !(
        parent?.type === "MemberExpression" &&
        parent.object === node &&
        !parent.computed &&
        ["keys", "values", "entries", "fromEntries", "freeze", "is"].includes(
          parent.property.name,
        )
      )
    )
      throw Error("Reflective effect mutation is unsupported");
    if (
      node.type === "Property" &&
      (node.computed ||
        (node.key?.name !== "once" &&
          node.key?.value !== "once" &&
          /^on[a-z]/i.test(node.key?.name ?? node.key?.value ?? "")))
    )
      throw Error("Effect handler properties are unsupported");
    if (
      node.type === "AssignmentExpression" ||
      node.type === "UpdateExpression"
    ) {
      const target = node.left ?? node.argument;
      if (
        (target?.type === "MemberExpression" &&
          /^(on[a-z]|innerHTML$|outerHTML$)/i.test(
            target.property?.name ?? target.property?.value ?? "",
          )) ||
        (target?.type === "Identifier" && /^on[a-z]/i.test(target.name))
      )
        throw Error("Unowned effect handler writes are unsupported");
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      ["setAttribute", "setAttributeNS", "insertAdjacentHTML"].includes(
        node.callee.property?.name,
      )
    ) {
      const name =
        node.arguments[node.callee.property.name === "setAttributeNS" ? 1 : 0];
      if (
        node.callee.property.name === "insertAdjacentHTML" ||
        name?.type !== "Literal" ||
        typeof name.value !== "string" ||
        /^on/i.test(name.value) ||
        name.value.toLowerCase() === "srcdoc"
      )
        throw Error("Unowned effect HTML handlers are unsupported");
    }
    if (node.type === "NewExpression")
      throw Error("Unowned constructed effects are unsupported");
    if (node.type?.startsWith("Export"))
      throw Error("Effects must not declare exports");
    if (
      node.async ||
      node.generator ||
      ["AwaitExpression", "YieldExpression"].includes(node.type)
    )
      throw Error("Asynchronous author effects are unsupported");
    if (
      node.type === "Identifier" &&
      ["addEventListener", "removeEventListener"].includes(node.name) &&
      !(parent?.type === "MemberExpression" && key === "property")
    )
      throw Error("Ambient listener registration is unsupported");
    if (
      node.type === "Literal" &&
      [
        "defaultView",
        "ownerDocument",
        "prototype",
        "then",
        "catch",
        "finally",
      ].includes(node.value)
    )
      throw Error("Unsupported author effect escape");
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      ["then", "catch", "finally"].includes(node.property.name)
    )
      throw Error("Asynchronous author effects are unsupported");
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.computed
    )
      throw Error("Computed effect calls are unsupported");
    if (node.type === "ImportDeclaration")
      for (const spec of node.specifiers) {
        if (spec.type !== "ImportSpecifier")
          throw Error("Only named effect imports are supported");
        if (
          ["createRoot", "render", "hydrate"].includes(
            spec.imported?.name ?? spec.imported?.value,
          )
        )
          throw Error("Unowned author render roots are unsupported");
      }
    if (
      node.type === "Identifier" &&
      [
        "Promise",
        "Reflect",
        "queueMicrotask",
        "requestIdleCallback",
        "cancelIdleCallback",
        "MutationObserver",
        "ResizeObserver",
        "IntersectionObserver",
        "defaultView",
        "ownerDocument",
        "prototype",
      ].includes(node.name)
    )
      throw Error("Unsupported author effect escape");
    if (
      node.type === "MemberExpression" &&
      node.computed &&
      node.property.type === "Literal" &&
      ["addEventListener", "removeEventListener"].includes(node.property.value)
    )
      throw Error("Computed effect listeners are unsupported");
    if (node.type === "Identifier" && node.name === "window") {
      if (
        parent?.type !== "MemberExpression" ||
        parent.object !== node ||
        parent.computed ||
        parent.optional
      )
        throw Error("Unsupported window reference");
      const property = parent.property.name;
      const owner = parent.__parent;
      if (
        (owner?.type === "AssignmentExpression" && owner.left === parent) ||
        owner?.type === "UpdateExpression"
      )
        throw Error("Author window writes are unsupported");
      if (!windowFields.has(property) && !windowMethods.has(property))
        throw Error("Unsupported window capability");
      if (windowMethods.has(property)) {
        const call = (parent as any).__parent;
        if (
          !call ||
          call.type !== "CallExpression" ||
          call.callee !== parent ||
          call.optional
        )
          throw Error("Window methods must be called directly");
        if (
          property !== "matchMedia" &&
          (!windowEvents.has(call.arguments[0]?.value) ||
            call.arguments[0]?.type !== "Literal")
        )
          throw Error("Unsupported window event");
        if (
          property === "matchMedia" &&
          (call.arguments.length !== 1 ||
            call.arguments[0]?.type !== "Literal" ||
            typeof call.arguments[0].value !== "string" ||
            call.arguments[0].value.length > 512)
        )
          throw Error("Media queries must be bounded literals");
        if (
          property === "matchMedia" &&
          (call.__parent?.type !== "MemberExpression" ||
            call.__parent.object !== call ||
            call.__parent.computed ||
            call.__parent.property.name !== "matches")
        )
          throw Error("Only immediate media matches reads are supported");
      }
      windows = true;
      edits.set(node, () => windowIdentifier);
    }
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      ["addEventListener", "removeEventListener"].includes(
        node.property.name,
      ) &&
      node.object.name !== "window"
    ) {
      const call = node.__parent;
      if (
        call?.type !== "CallExpression" ||
        call.callee !== node ||
        call.optional ||
        node.optional
      )
        throw Error("Listeners must be called directly");
      listeners = true;
      edits.set(
        call,
        (render) =>
          lifetimeIdentifier +
          "." +
          (node.property.name === "addEventListener" ? "listen" : "unlisten") +
          "(" +
          [render(node.object), ...call.arguments.map(render)].join(",") +
          ")",
      );
    }
    if (
      node.type === "Identifier" &&
      Object.hasOwn(timers, node.name) &&
      !(parent?.type === "MemberExpression" && key === "property") &&
      !(parent?.type === "Property" && key === "key" && !parent.shorthand)
    ) {
      if (
        parent?.type !== "CallExpression" ||
        parent.callee !== node ||
        parent.optional
      )
        throw Error("Timers must be unshadowed direct calls");
      time = true;
      edits.set(node, () => lifetimeIdentifier + "." + timers[node.name]);
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "__parent") continue;
      const descend = (child: any) => {
        if (child && typeof child === "object") {
          Object.defineProperty(child, "__parent", {
            value: node,
            configurable: true,
          });
          visit(child, node, childKey);
        }
      };
      if (Array.isArray(value)) value.forEach(descend);
      else descend(value);
    }
  };
  visit(ast);
  const render = (node: any): string => {
    const edit = edits.get(node);
    if (edit) return edit(render);
    const children: any[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "__parent") continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (
          child &&
          typeof child === "object" &&
          typeof child.start === "number"
        )
          children.push(child);
    }
    children.sort((a, b) => a.start - b.start);
    let cursor = node.start,
      text = "";
    for (const child of children.filter(
      (item, index) =>
        index === 0 ||
        item.start !== children[index - 1].start ||
        item.end !== children[index - 1].end,
    )) {
      text += source.slice(cursor, child.start) + render(child);
      cursor = child.end;
    }
    return text + source.slice(cursor, node.end);
  };
  const rewritten = render(ast);
  admitAuthorSource(rewritten);
  return {
    source: rewritten,
    lifetimeIdentifier,
    windowIdentifier,
    capabilities: [
      "effects",
      ...(windows ? ["window-scalars" as const] : []),
      ...(listeners ? ["owned-listeners" as const] : []),
      ...(time ? ["owned-timers" as const] : []),
    ],
  };
}
