/** Exact archived kit names; these are presentation components, never action adapters. */
export type PresentationKitTag =
  | "Accordion"
  | "AccordionItem"
  | "AccordionTrigger"
  | "AccordionContent"
  | "TooltipProvider"
  | "Tooltip"
  | "TooltipTrigger"
  | "TooltipContent"
  | "Dialog"
  | "DialogTrigger"
  | "DialogClose"
  | "DialogContent"
  | "Avatar"
  | "AvatarFallback";
export interface PresentationKitCapability {
  tag: PresentationKitTag;
  /** Transparent providers discard their own DOM attrs; deferred nodes can be absent until opened. */
  identity: "direct" | "deferred" | "transparent";
  /** Descendant identities may not exist while closed, independently of this node's shell. */
  conditionalChildren: boolean;
  portal: boolean;
  requiredAncestor?: PresentationKitTag;
}
