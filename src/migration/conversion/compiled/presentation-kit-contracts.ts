/** Exact archived kit names; these are presentation components, never action adapters. */
export type PresentationKitTag =
  | "Collapsible"
  | "CollapsibleTrigger"
  | "CollapsibleContent"
  | "Tabs"
  | "TabsList"
  | "TabsTrigger"
  | "TabsContent"
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
  /** Exact viewer-local declared Value dependency; source traversal resolves its type. */
  scalarBinding?: PresentationScalarBinding;
}

/** Source-derived transparent roots requiring a layout-neutral DOM identity host. */
export interface PresentationIdentityHost {
  readonly tag: "Tooltip" | "TooltipProvider" | "FileUpload";
  readonly id: string;
}

export interface PresentationScalarBinding {
  readonly tag: "Dialog";
  readonly binding: string;
  readonly valueType: "boolean";
}
