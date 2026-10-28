/**
 * Names-only contract for the story design system, owned by lib/jsx because its
 * validator checks tags against it — importable WITHOUT pulling the component sources in.
 * The compiler (lib/compiled-page/compiler.ts) renders these tags directly or maps them to shared kit components.
 */

import type { JsxElement, JsxNode } from './types';

/**
 * THE DATA COMPONENTS' EARLIER NAMES, accepted forever: `<Question>` is `<Chart>` and `<Number>` is `<Cell>`.
 * Stored documents keep the names they were written with (no migration rewrites them), so the parser is the one
 * alias point: it gives every element its canonical `tag` and keeps the author's spelling as `authoredTag`, which
 * only the code that writes source back reads (lib/jsx/serialize, the in-place id stamp). A tree stored before the
 * rename and revived without a parse (the document graph, a prepared page) goes through {@link canonicalNodes}.
 * Everything that teaches or generates markup uses the new names.
 */
export const COMPONENT_ALIASES: Readonly<Record<string, string>> = Object.freeze({ Question: 'Chart', Number: 'Cell' });
const ALIASES: ReadonlyMap<string, string> = new Map(Object.entries(COMPONENT_ALIASES));

/** The registered name a tag is spelled for: itself unless it is an earlier name. */
export const canonicalComponent = (tag: string): string => ALIASES.get(tag) ?? tag;

/**
 * A stored tree with every earlier name canonicalised (the spelling kept as `authoredTag`), copying only the
 * elements on a path to one; the same array when it names none.
 */
export function canonicalNodes(nodes: JsxNode[]): JsxNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.type !== 'element') return node;
    const children = canonicalNodes(node.children);
    const tag = canonicalComponent(node.tag);
    if (children === node.children && tag === node.tag) return node;
    changed = true;
    const element: JsxElement = { ...node, tag, children };
    if (tag !== node.tag) element.authoredTag = node.tag;
    return element;
  });
  return changed ? next : nodes;
}

/** The shadcn component tags a new-format (`format:'jsx'`) story may use. */
export const STORY_UI_COMPONENT_NAME_LIST = [
  'Markdown',
  'Dialog', 'DialogTrigger', 'DialogContent', 'DialogClose',
  'Mermaid', 'DeckGL', 'Isometric',
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
  // The bound-control kit: themed two-way
  // controls over Helmet `<Value>`s — the fancy siblings of the bindable
  // native `input`/`select`/`textarea` (lib/dataflow/dataflow.ts REF_ATTRS).
  // `Input`/`Textarea` are the TEXT members: a bare `<input>` keeps binding,
  // but preflight leaves it without a border or padding, so a form written
  // from the native tags alone has no visual family at all.
  'Input', 'Textarea', 'Select', 'Slider', 'DatePicker', 'Segmented', 'Switch', 'FileUpload',
  'SlideDeck', 'Slide',
  // A PDF the document links, as a card that opens it.
  'File',
  'Icon',
  // WHO IS READING, and what to do about it (lib/islands/kit/people.tsx). `<User userId="$_me">` names a person from the
  // same cards a DataTable cell uses — the face and the handle it composes are
  // also tags of their own; `<SignIn>` is the guest's door.
  'User', 'UserImage', 'UserHandle', 'SignIn',
  'DataTable', 'Column', 'For',
  // A folder's listing. Bound like every other data
  // embed — `data="$children"` — over the children table lib/folders computes.
  'Files',
] as const;

/**
 * The registered components a paragraph may hold: what each one renders is phrasing content — a `<span>`, a
 * `<button>`, an `<img>`, an `<svg>` — or no box of its own (a Tooltip, a Popover, a Dialog are their parts), so
 * the HTML parser leaves an open `<p>` around it open. Their CHILDREN still count: a Tooltip whose content holds a
 * `<p>` closes the paragraph as that `<p>` would. Every other component — a block kit component, a script
 * component's mount, a `<For>`'s wrapper — renders a box that closes an open `<p>`, so lib/document/nesting makes
 * such a paragraph a `<div>`. Checked against the real renderer and parser, component by component
 * (lib/publish/__tests__/nesting-parses-back.test.ts): a kit change that puts a `<div>` in one of these fails there.
 */
export const PHRASING_COMPONENTS: ReadonlySet<string> = new Set([
  'Badge', 'Button', 'Icon', 'Cell',
  'Avatar', 'AvatarImage', 'AvatarFallback', 'AvatarBadge',
  'User', 'UserImage', 'UserHandle', 'SignIn',
  'TooltipProvider', 'Tooltip', 'TooltipTrigger', 'TooltipContent',
  'Popover', 'PopoverTrigger',
  'Dialog', 'DialogTrigger',
]);

/**
 * The tags whose `id` names a PERSON rather than an element — the seam
 * the compiler takes `id` out at, and the set lib/artifacts
 * `drawsPeople` and lib/dataflow/dataflow REF_ATTRS answer for. Names only, so
 * server-side validation still pulls in no component code.
 */
export const PERSON_TAGS: ReadonlySet<string> = new Set(['User', 'UserImage', 'UserHandle']);

/**
 * The kit components whose TEXT is the author's, typed in place like a paragraph's: each renders its children,
 * unchanged, as the content of the one element named here (the compiled reader's static kit HTML, stamped with
 * the node's `data-mx-ast`), so a caret in that element types into exactly the children the source holds.
 *
 * Opt-in, and the one declaration: the editor's text-host rule (lib/story-ui/host-classify), the write-back
 * (lib/data/story/jsx-edit) and the toolbar read it. A kit component missing here stays locked — its DOM is render
 * output. `compiled-page/__tests__/kit-text-hosts.test.ts` proves each entry renders as declared. Layout shells
 * (Card, CardHeader, Alert, the Table sections), controls (Button, the triggers), islands and components that draw
 * their own content (BreadcrumbEllipsis, Separator) are deliberately absent.
 *
 * The element also decides which inline marks the text may carry: phrasing marks everywhere, links only where
 * the element is not a link itself.
 */
const KIT_TEXT_ELEMENTS: Readonly<Record<string, 'td' | 'th' | 'caption' | 'div' | 'span' | 'a'>> = {
  TableHead: 'th', TableCell: 'td', TableCaption: 'caption',
  CardTitle: 'div', CardDescription: 'div', CardContent: 'div', CardFooter: 'div',
  AlertTitle: 'div', AlertDescription: 'div',
  Badge: 'span', BreadcrumbLink: 'a', BreadcrumbPage: 'span',
};

/** The element kit text component `tag` renders its text in; undefined for any other tag. */
export const kitTextElement = (tag: string): string | undefined =>
  Object.hasOwn(KIT_TEXT_ELEMENTS, tag) ? KIT_TEXT_ELEMENTS[tag] : undefined;

/** Whether the text of kit text component `tag` may carry links (its element is not a link already). */
export const kitTextAcceptsLinks = (tag: string): boolean => {
  const element = kitTextElement(tag);
  return !!element && element !== 'a';
};

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
 * The explicit HTML tag allowlist for new-format stories: content/document tags only,
 * plus the SVG drawing subset above.
 * `script`/`object`/`embed`/`base`/`form`/`meta`/`link` are excluded (the validator
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
  // put it in.
  'video', 'audio', 'track',
  // A player or page, framed as written: an https `src` and a short attribute
  // list (lib/jsx/validate `iframeErrors`); which hosts load is the document
  // CSP's `frame-src` (lib/page-styles/document-csp, `<meta name="csp-frame">`).
  'iframe',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'address',
  'hr', 'br', 'wbr', 'time', 'data', 'details', 'summary',
  // The INTERACTIVE vocabulary. A document may carry its own <script>
  // (lib/document/helmet.ts), and a script with nothing to drive is not a
  // feature — these are the elements it acts on. `form`, `object` and `embed`
  // stay denied (lib/jsx/dangerous-tags.ts): navigation hijacks and plugin
  // contexts, which no author document needs.
  'button', 'input', 'label', 'select', 'option', 'optgroup', 'textarea',
  'fieldset', 'legend', 'output', 'meter', 'progress', 'datalist',
  'canvas', 'dialog', 'template',
  ...STORY_SVG_TAGS,
] as const;
