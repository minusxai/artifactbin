/**
 * WHICH CODE A DOCUMENT'S TAGS NEED — names only, so the server (the prepared
 * page, the preload hints) and both reader runtimes read one table without
 * importing a single component.
 *
 * Every tag the runtime can draw is either CORE (rendered by code every
 * runtime carries: the interpreter's own `<For>`, the glyph `<Icon>`, the app's
 * `<Tooltip>`) or belongs to exactly one KIT CHUNK — a module the runtime
 * imports on demand (lib/story-runtime/kit/<chunk>.tsx) and the server
 * preloads for the documents that draw it. A page of prose names none.
 *
 * Every tag is also classified: STATIC components render their final markup
 * on the server and do nothing in the browser (no handler, no effect, no
 * state), so a document made only of them — and of plain HTML — needs no
 * runtime at all once it is served. Anything that listens, loads, measures or
 * reads a value is INTERACTIVE, and so is any tag this table does not name.
 */
import type { JsxNode } from '@/lib/jsx';
import { isPersonMentionHref } from '@/lib/person-mentions';

interface ChunkSpec { tags: readonly string[]; interactive: boolean }

/** The kit chunks, by id. The id names the module lib/story-runtime/kit/<id>.tsx. */
export const KIT_CHUNKS = {
  card: { tags: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter', 'CardAction'], interactive: false },
  badge: { tags: ['Badge'], interactive: false },
  alert: { tags: ['Alert', 'AlertTitle', 'AlertDescription'], interactive: false },
  table: { tags: ['Table', 'TableHeader', 'TableBody', 'TableFooter', 'TableRow', 'TableHead', 'TableCell', 'TableCaption'], interactive: false },
  separator: { tags: ['Separator'], interactive: false },
  skeleton: { tags: ['Skeleton'], interactive: false },
  progress: { tags: ['Progress'], interactive: false },
  breadcrumb: { tags: ['Breadcrumb', 'BreadcrumbList', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbPage', 'BreadcrumbSeparator', 'BreadcrumbEllipsis'], interactive: false },
  grid: { tags: ['Grid', 'GridItem'], interactive: false },
  // A card that OPENS a link: an `<a href>` works without a runtime.
  file: { tags: ['File'], interactive: false },
  video: { tags: ['Video'], interactive: false },
  button: { tags: ['Button'], interactive: true },
  // Radix shows the fallback until the image has LOADED, which only a runtime sees.
  avatar: { tags: ['Avatar', 'AvatarImage', 'AvatarFallback', 'AvatarBadge', 'AvatarGroup', 'AvatarGroupCount'], interactive: true },
  tabs: { tags: ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'], interactive: true },
  accordion: { tags: ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'], interactive: true },
  collapsible: { tags: ['Collapsible', 'CollapsibleTrigger', 'CollapsibleContent'], interactive: true },
  popover: { tags: ['Popover', 'PopoverTrigger', 'PopoverContent', 'PopoverAnchor', 'PopoverHeader', 'PopoverTitle', 'PopoverDescription'], interactive: true },
  dialog: { tags: ['Dialog', 'DialogTrigger', 'DialogContent', 'DialogClose'], interactive: true },
  controls: { tags: ['Input', 'Textarea', 'Select', 'Slider', 'DatePicker', 'Segmented', 'Switch'], interactive: true },
  slides: { tags: ['SlideDeck', 'Slide'], interactive: true },
  user: { tags: ['User', 'UserImage', 'UserHandle'], interactive: true },
  'sign-in': { tags: ['SignIn'], interactive: true },
  'data-table': { tags: ['DataTable', 'Column'], interactive: true },
  files: { tags: ['Files'], interactive: true },
  mermaid: { tags: ['Mermaid'], interactive: true },
  'deck-gl': { tags: ['DeckGL'], interactive: true },
  iframe: { tags: ['Iframe'], interactive: true },
  question: { tags: ['Question'], interactive: true },
  number: { tags: ['Number'], interactive: true },
} as const satisfies Record<string, ChunkSpec>;

export type KitChunkId = keyof typeof KIT_CHUNKS;
export const KIT_CHUNK_IDS = Object.keys(KIT_CHUNKS) as KitChunkId[];

/** Tags every runtime draws with code it already carries; `interactive` as above. */
export const CORE_TAGS: Readonly<Record<string, boolean>> = {
  Icon: false,
  // The app's own tooltip (components/Tooltip): chrome the runtime's hints use too.
  Tooltip: true, TooltipTrigger: true, TooltipContent: true, TooltipProvider: true,
  // A template over a table: value-dependent by definition.
  For: true,
};

const CHUNK_OF: ReadonlyMap<string, KitChunkId> = new Map(
  KIT_CHUNK_IDS.flatMap((id) => KIT_CHUNKS[id].tags.map((tag) => [tag, id] as const)),
);

/** The chunk that draws `tag`, or null for core, HTML and unknown tags. */
export const kitChunkOf = (tag: string): KitChunkId | null => CHUNK_OF.get(tag) ?? null;

/** Whether `tag` is a component that does nothing in the browser. Unknown tags are interactive. */
export function isStaticComponent(tag: string): boolean {
  const chunk = CHUNK_OF.get(tag);
  if (chunk) return !KIT_CHUNKS[chunk].interactive;
  return CORE_TAGS[tag] === false;
}

const walkElements = (nodes: readonly JsxNode[], visit: (node: Extract<JsxNode, { type: 'element' }>) => void): void => {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    visit(node);
    walkElements(node.children, visit);
  }
};

/**
 * The chunks `nodes` can draw without a new version — every element, in every
 * branch of a conditional, every `<For>` template, every `<Column>` cell and
 * every slide — each once, in the table's order (a stable key and preload order).
 */
export function kitChunksOf(nodes: readonly JsxNode[]): KitChunkId[] {
  const found = new Set<KitChunkId>();
  walkElements(nodes, (node) => {
    if (!node.isComponent) return;
    const chunk = CHUNK_OF.get(node.tag);
    if (chunk) found.add(chunk);
  });
  return KIT_CHUNK_IDS.filter((id) => found.has(id));
}

/**
 * Whether `nodes` draw any component that is not static — at any depth, in
 * any branch. The served document's rule for shipping its runtime
 * (lib/story/document), beside its data, its script and its readers' roles.
 */
export function drawsInteractiveComponent(nodes: readonly JsxNode[]): boolean {
  let found = false;
  walkElements(nodes, (node) => { if (node.isComponent && !isStaticComponent(node.tag)) found = true; });
  return found;
}

/** A `$name` reference in a static string: a bound value, source or template. */
const REFERENCE = /\$[A-Za-z_]/;

/**
 * Whether the served markup of `nodes` is FINAL: nothing in it can change, or
 * answer the reader, after the server rendered it. True only when every
 * component is static, nothing is conditional or reactive (no `control` node,
 * no non-static attribute or expression, no `$` reference in an attribute),
 * and no link is a person mention (whose card is fetched in the browser).
 *
 * The document's declared data and its author script are decided beside this
 * (lib/story/prepared-page.server): either one makes a document live too.
 */
export function isStaticStory(nodes: readonly JsxNode[]): boolean {
  let still = true;
  const check = (list: readonly JsxNode[]): void => {
    for (const node of list) {
      if (!still) return;
      if (node.type === 'text') continue;
      if (node.type === 'expression') { if (!node.value.static) still = false; continue; }
      if (node.control && node.control.kind !== 'fragment') { still = false; return; }
      if (node.isComponent && !isStaticComponent(node.tag)) { still = false; return; }
      for (const attribute of node.attributes) {
        const { value } = attribute;
        if (!value.static) { still = false; return; }
        if (typeof value.json === 'string' && REFERENCE.test(value.json)) { still = false; return; }
        if (node.tag === 'a' && attribute.name === 'href' && typeof value.json === 'string' && isPersonMentionHref(value.json)) { still = false; return; }
      }
      check(node.children);
    }
  };
  check(nodes);
  return still;
}
