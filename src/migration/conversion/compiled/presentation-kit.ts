import type {
  PresentationKitCapability,
  PresentationKitTag,
} from "./presentation-kit-contracts.ts";

const definitions: Record<
  PresentationKitTag,
  Omit<PresentationKitCapability, "tag">
> = {
  Accordion: { identity: "direct", conditionalChildren: false, portal: false },
  AccordionItem: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Accordion",
  },
  AccordionTrigger: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "AccordionItem",
  },
  AccordionContent: {
    identity: "direct",
    conditionalChildren: true,
    portal: false,
    requiredAncestor: "AccordionItem",
  },
  TooltipProvider: {
    identity: "transparent",
    conditionalChildren: false,
    portal: false,
  },
  Tooltip: {
    identity: "transparent",
    conditionalChildren: false,
    portal: false,
  },
  TooltipTrigger: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Tooltip",
  },
  TooltipContent: {
    identity: "deferred",
    conditionalChildren: true,
    portal: true,
    requiredAncestor: "Tooltip",
  },
  Dialog: { identity: "direct", conditionalChildren: false, portal: false },
  DialogTrigger: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Dialog",
  },
  DialogClose: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Dialog",
  },
  DialogContent: {
    identity: "direct",
    conditionalChildren: false,
    portal: true,
    requiredAncestor: "Dialog",
  },
  Avatar: { identity: "direct", conditionalChildren: false, portal: false },
  AvatarFallback: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Avatar",
  },
};
const api: Record<PresentationKitTag, readonly string[]> = {
  Accordion: ["type", "collapsible", "defaultValue", "value", "orientation"],
  AccordionItem: ["value", "disabled"],
  AccordionTrigger: [],
  AccordionContent: ["forceMount"],
  TooltipProvider: [],
  Tooltip: ["defaultOpen"],
  TooltipTrigger: [],
  TooltipContent: ["forceMount"],
  Dialog: ["defaultOpen", "open"],
  DialogTrigger: ["wrapsControl", "disabled"],
  DialogClose: ["wrapsControl", "disabled"],
  // run/args belong to the mutation adapter, never this presentation capability.
  DialogContent: ["stacked"],
  Avatar: ["size"],
  AvatarFallback: [],
};
export function presentationKitComponent(
  tag: string,
): PresentationKitCapability | null {
  return Object.hasOwn(definitions, tag)
    ? {
        tag: tag as PresentationKitTag,
        ...definitions[tag as PresentationKitTag],
      }
    : null;
}
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 4096 &&
  !value.includes("\0") &&
  !/^\$/.test(value);
/** Ancestors are ordered outermost first. No AST execution or callback/ref interpretation occurs here. */
export function admitPresentationKit(
  tag: string,
  attrs: Record<string, unknown>,
  ancestors: readonly string[] = [],
): PresentationKitCapability {
  const capability = presentationKitComponent(tag);
  if (!capability) throw Error("Unsupported presentation kit component");
  const required = capability.requiredAncestor;
  if (required) {
    const index = ancestors.lastIndexOf(required);
    if (
      index < 0 ||
      (required === "AccordionItem" &&
        (ancestors.lastIndexOf("Accordion") < 0 ||
          ancestors.lastIndexOf("Accordion") > index))
    )
      throw Error("Missing presentation kit context");
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (
      ["constructor", "prototype", "__proto__"].includes(key) ||
      /^on/i.test(key)
    )
      throw Error("Executable presentation attribute");
    if (api[capability.tag].includes(key)) {
      if (
        [
          "collapsible",
          "disabled",
          "forceMount",
          "defaultOpen",
          "open",
          "wrapsControl",
          "stacked",
        ].includes(key)
      ) {
        if (typeof value !== "boolean")
          throw Error("Invalid presentation boolean");
      } else if (!text(value)) throw Error("Invalid presentation text");
      if (key === "type" && value !== "single")
        throw Error("Unsupported Accordion type");
      if (
        key === "orientation" &&
        !["vertical", "horizontal"].includes(value as string)
      )
        throw Error("Invalid Accordion orientation");
      continue;
    }
    const identity = key === "id" || /^data-af-(?:id|comment)$/.test(key);
    const dom =
      capability.identity !== "transparent" &&
      (["className", "class", "title", "role", "style", "tabIndex"].includes(
        key,
      ) ||
        /^(?:aria|data)-[a-z][a-z0-9-]*$/.test(key));
    if (!identity && !dom) throw Error("Unsupported presentation attribute");
    if (
      !(key === "tabIndex"
        ? Number.isInteger(value) &&
          (value as number) >= -1 &&
          (value as number) <= 32767
        : text(value))
    )
      throw Error("Invalid presentation DOM attribute");
  }
  if (tag === "AccordionItem" && (!text(attrs.value) || !attrs.value))
    throw Error("AccordionItem requires value");
  if (attrs.forceMount === true) {
    capability.conditionalChildren = false;
    if (capability.identity === "deferred") capability.identity = "direct";
  }
  return capability;
}
