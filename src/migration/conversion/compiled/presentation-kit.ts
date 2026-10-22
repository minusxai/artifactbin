import type {
  PresentationKitCapability,
  PresentationKitTag,
} from "./presentation-kit-contracts.ts";

// The archived compiler forces TabsContent, AccordionContent and TooltipContent forceMount=true
// in both served and browser output (compiler kitParts), preserving hidden identities.
const definitions: Record<
  PresentationKitTag,
  Omit<PresentationKitCapability, "tag">
> = {
  Tabs: { identity: "direct", conditionalChildren: false, portal: false },
  TabsList: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Tabs",
  },
  TabsTrigger: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Tabs",
  },
  TabsContent: {
    identity: "direct",
    conditionalChildren: false,
    portal: false,
    requiredAncestor: "Tabs",
  },
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
    conditionalChildren: false,
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
    identity: "direct",
    conditionalChildren: false,
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
  Tabs: ["defaultValue", "value", "orientation", "dir"],
  TabsList: ["variant"],
  TabsTrigger: ["value", "disabled"],
  TabsContent: ["value", "forceMount"],
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
        tag === "Dialog" &&
        key === "open" &&
        typeof value === "string" &&
        /^\$[A-Za-z]\w*$/.test(value) &&
        !["constructor", "prototype", "__proto__"].includes(value.slice(1))
      ) {
        capability.scalarBinding = {
          tag: "Dialog",
          binding: value.slice(1),
          valueType: "boolean",
        };
        continue;
      }
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
        throw Error("Invalid presentation orientation");
      // The archived keyboard implementation is LTR; a dir attribute alone cannot add RTL behavior.
      if (tag === "Tabs" && key === "dir" && value !== "ltr")
        throw Error("Unsupported Tabs direction");
      if (
        tag === "TabsList" &&
        key === "variant" &&
        !["default", "line"].includes(value as string)
      )
        throw Error("Unsupported Tabs variant");
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
  if (
    ["AccordionItem", "TabsTrigger", "TabsContent"].includes(tag) &&
    (!text(attrs.value) || !attrs.value)
  )
    throw Error("Presentation item requires value");
  if (attrs.forceMount === true) {
    capability.conditionalChildren = false;
    if (capability.identity === "deferred") capability.identity = "direct";
  }
  return capability;
}
