/**
 * The table both reader runtimes and the server read to decide which kit code
 * a document needs (lib/story-ui/kit-chunks): which chunk each tag lives in,
 * which chunks a document can draw, and whether its served markup is final.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { CORE_TAGS, KIT_CHUNKS, KIT_CHUNK_IDS, isStaticComponent, isStaticStory, kitChunkOf, kitChunksOf } from '@/lib/story-ui/kit-chunks';

const nodes = (src: string): JsxNode[] => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${JSON.stringify(parsed)}`);
  return parsed.nodes;
};

/** Every tag the runtime registry answers for: the story vocabulary plus the data embeds. */
const RUNTIME_TAGS = [...STORY_UI_COMPONENT_NAME_LIST, 'Question', 'Number'];

describe('kit chunk table', () => {
  it('places every runtime tag exactly once: in one chunk, or in the core', () => {
    const placements = RUNTIME_TAGS.map((tag) => [tag, [...KIT_CHUNK_IDS.filter((id) => (KIT_CHUNKS[id].tags as readonly string[]).includes(tag)), ...(tag in CORE_TAGS ? ['core'] : [])]] as const);
    expect(placements.filter(([, where]) => where.length !== 1)).toEqual([]);
  });

  it('names no tag the runtime cannot draw', () => {
    const known = new Set(RUNTIME_TAGS);
    const named = [...KIT_CHUNK_IDS.flatMap((id) => KIT_CHUNKS[id].tags), ...Object.keys(CORE_TAGS)];
    expect(named.filter((tag) => !known.has(tag))).toEqual([]);
  });

  it('classifies what does nothing in the browser as static, and everything else — unknown tags too — as interactive', () => {
    for (const tag of ['Card', 'CardTitle', 'Badge', 'Alert', 'TableCell', 'Separator', 'Progress', 'BreadcrumbLink', 'Grid', 'GridItem', 'Icon', 'File', 'Video', 'Skeleton']) {
      expect(isStaticComponent(tag), tag).toBe(true);
    }
    for (const tag of ['Button', 'Tabs', 'TabsTrigger', 'Accordion', 'Collapsible', 'Popover', 'Dialog', 'Tooltip', 'Input', 'Select', 'Slide', 'SlideDeck', 'User', 'Avatar', 'SignIn', 'DataTable', 'Column', 'Files', 'Mermaid', 'DeckGL', 'Iframe', 'Question', 'Number', 'For', 'Unheard']) {
      expect(isStaticComponent(tag), tag).toBe(false);
    }
  });

  it('maps HTML and core tags to no chunk', () => {
    expect(kitChunkOf('div')).toBeNull();
    expect(kitChunkOf('Icon')).toBeNull();
    expect(kitChunkOf('For')).toBeNull();
    expect(kitChunkOf('CardTitle')).toBe('card');
  });
});

describe('the chunks a document draws', () => {
  it('a page of prose draws none', () => {
    expect(kitChunksOf(nodes('<article><h1>Title</h1><p>Words, <strong>bold</strong> words.</p><ul><li>one</li></ul></article>'))).toEqual([]);
  });

  it('names each chunk once, in the table order, however deep and often it is drawn', () => {
    const drawn = kitChunksOf(nodes('<div><Card><CardHeader><CardTitle>T <Badge>b</Badge></CardTitle></CardHeader><CardContent><Badge>again</Badge></CardContent></Card><Alert><AlertTitle>x</AlertTitle></Alert></div>'));
    expect(drawn).toEqual(['card', 'badge', 'alert']);
  });

  it('reaches both branches of a conditional, and the right side of an `&&`', () => {
    const drawn = kitChunksOf(nodes('<Helmet><Value name="on" type="boolean" value={true} /></Helmet><div>{$on ? <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs> : <Accordion type="single"><AccordionItem value="x"><AccordionTrigger>x</AccordionTrigger></AccordionItem></Accordion>}{$on && <Progress value={3} />}</div>'));
    expect(drawn).toEqual(expect.arrayContaining(['tabs', 'accordion', 'progress']));
    expect(drawn).toHaveLength(3);
  });

  it('reaches every template: For rows, DataTable columns and their cells, and slides', () => {
    const drawn = kitChunksOf(nodes('<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet>'
      + '<For each={$rows} keyBy="k"><Card><Badge>$_row.k</Badge></Card></For>'
      + '<DataTable data="$rows"><Column col="k"><Select value="$_row.k" run="$save" options={["a"]} /></Column><Column col="k"><Button run="$drop">x</Button></Column></DataTable>'
      + '<SlideDeck><Slide><h2>One</h2><Popover><PopoverTrigger>?</PopoverTrigger><PopoverContent>!</PopoverContent></Popover></Slide></SlideDeck>'));
    expect(new Set(drawn)).toEqual(new Set(['card', 'badge', 'data-table', 'controls', 'button', 'slides', 'popover']));
  });
});

describe('a static story', () => {
  const judged = (src: string) => isStaticStory(nodes(src));

  it('is prose, and prose with static components', () => {
    expect(judged('<article><h1>T</h1><p>p</p><table><tbody><tr><td>1</td></tr></tbody></table></article>')).toBe(true);
    expect(judged('<div><Card><CardHeader><CardTitle>T</CardTitle></CardHeader><CardContent><Badge variant="secondary">b</Badge></CardContent></Card><Alert><AlertDescription>a</AlertDescription></Alert><Icon name="check" /></div>')).toBe(true);
  });

  it('is not one with any interactive component', () => {
    expect(judged('<div><Card><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs></Card></div>')).toBe(false);
    expect(judged('<div><Button>Go</Button></div>')).toBe(false);
    expect(judged('<SlideDeck><Slide><h2>One</h2></Slide></SlideDeck>')).toBe(false);
  });

  it('is not one that renders by value: a conditional, a reactive expression or attribute, a repeat, a bound reference', () => {
    expect(judged('<Helmet><Value name="on" type="boolean" value={true} /></Helmet><div>{$on ? <p>a</p> : <p>b</p>}</div>')).toBe(false);
    expect(judged('<Helmet><Value name="n" type="number" value={1} /></Helmet><p>{$n}</p>')).toBe(false);
    expect(judged('<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet><For each={$rows} keyBy="k"><p>$_row.k</p></For>')).toBe(false);
    expect(judged('<Helmet><Value name="pick" type="text" value="a" /></Helmet><img alt="x" src="https://cdn.example.com/{$pick}.png" />')).toBe(false);
  });

  it('is not one that links a person, whose card the browser fetches', () => {
    expect(judged('<p>Ask <a href="/people/u_123">@ana</a></p>')).toBe(false);
    expect(judged('<p>Read <a href="https://example.com/people">this</a></p>')).toBe(true);
  });
});
