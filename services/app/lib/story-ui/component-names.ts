/**
 * Names-only contract for the story design system — importable by
 * server-side validation (lib/jsx) WITHOUT pulling React or the component sources in.
 * `lib/story-ui/registry.ts` maps these names to the real components; a registry test
 * asserts the two never drift.
 */

/** The shadcn component tags a new-format (`format:'jsx'`) story may use. */
export const STORY_UI_COMPONENT_NAME_LIST = [
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter', 'CardAction',
  'Badge', 'Button',
  'Alert', 'AlertTitle', 'AlertDescription',
  'Table', 'TableHeader', 'TableBody', 'TableFooter', 'TableRow', 'TableHead', 'TableCell', 'TableCaption',
  'Separator', 'Skeleton', 'Progress',
  'Breadcrumb', 'BreadcrumbList', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbPage', 'BreadcrumbSeparator', 'BreadcrumbEllipsis',
  'Avatar', 'AvatarImage', 'AvatarFallback', 'AvatarBadge', 'AvatarGroup', 'AvatarGroupCount',
  'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
  'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
  'Collapsible', 'CollapsibleTrigger', 'CollapsibleContent',
  'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
  'Popover', 'PopoverTrigger', 'PopoverContent', 'PopoverAnchor', 'PopoverHeader', 'PopoverTitle', 'PopoverDescription',
  'Grid', 'GridItem',
  // The bound-control kit (components/kit/controls.tsx): themed two-way
  // controls over Helmet `<Value>`s — the fancy siblings of the bindable
  // native `input`/`select`/`textarea` (lib/story/dataflow.ts REF_ATTRS).
  'Select', 'Slider', 'DatePicker', 'Segmented', 'Switch',
  'SlideDeck', 'Slide',
  'Video',
  // A PDF the document links, as a card that opens it (components/kit/file.tsx).
  'File',
  'Icon',
  'DataTable',
  // A folder's listing (components/kit/files.tsx). Bound like every other data
  // embed — `data="$children"` — over the children table lib/folders computes.
  'Files',
] as const;

/**
 * The inline-SVG DRAWING subset (canonical casing — SVG tags are case-sensitive
 * in the DOM, so consumers that create or match elements must use THESE names;
 * the validator compares case-insensitively). Deliberately minimal: no
 * `use`/`image` (external fetch), no `foreignObject` (nested HTML context), no
 * SMIL (`animate`), no `pattern`/`mask`/`marker`/`symbol` until a real motif
 * needs them. Paint attributes are additionally restricted to local `url(#…)`
 * targets by both gates (lib/jsx/url-attrs.ts).
 */
export const STORY_SVG_TAGS = [
  'svg', 'g', 'defs',
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'title', 'desc',
] as const;

/**
 * The explicit HTML tag allowlist for new-format stories (§2): content/document tags only,
 * plus the SVG drawing subset above.
 * `script`/`iframe`/`object`/`embed`/`base`/`form`/`meta`/`link` are excluded (the validator
 * additionally hard-denies them for every story format).
 */
export const STORY_HTML_TAGS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'kbd', 'samp', 'var',
  'blockquote', 'cite', 'q', 'abbr', 'mark', 'small', 'sub', 'sup', 'del', 'ins',
  'img', 'figure', 'figcaption', 'picture', 'source',
  // Media the served document's CSP already grants (`media-src 'self' data:
  // blob:`): without these, `<source>` was in the vocabulary with nothing to
  // put it in. Remote media stays blocked by that same CSP, and the <Video>
  // component remains the door for the three sanctioned embed hosts.
  'video', 'audio', 'track',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'address',
  'hr', 'br', 'wbr', 'time', 'data', 'details', 'summary',
  // The INTERACTIVE vocabulary. A document may carry its own <script>
  // (lib/story/helmet.ts), and a script with nothing to drive is not a
  // feature — these are the elements it acts on. `form`, `iframe`, `object`
  // and `embed` stay denied (lib/jsx/dangerous-tags.ts): navigation hijacks
  // and nested browsing contexts, which no author document needs.
  'button', 'input', 'label', 'select', 'option', 'optgroup', 'textarea',
  'fieldset', 'legend', 'output', 'meter', 'progress', 'datalist',
  'canvas', 'dialog', 'template',
  ...STORY_SVG_TAGS,
] as const;
