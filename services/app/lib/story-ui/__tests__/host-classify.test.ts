/**
 * Which nodes take a caret, decided from the SOURCE (lib/story-ui/host-classify): kit components whose children
 * are the author's text are typed in like a paragraph; text that comes from data, is computed or is drawn by a
 * component stays locked, and says which.
 */
import { describe, expect, it } from 'vitest';
import type { JsxElement } from '@/lib/jsx';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { isEditableTextHost, kitTextHost, kitTextMarkAllowed, resolveJsxNodeAtPath, textHost, textLockOf, textOwnerPath } from '../host-classify';

const element = (source: string): JsxElement => {
  const node = parseJsxOrThrow(source).nodes[0];
  if (node?.type !== 'element') throw new Error(`not an element: ${source}`);
  return node;
};

describe('kit text components', () => {
  it.each([
    '<TableCell id="eVAF">Wed</TableCell>',
    '<TableHead>Day</TableHead>',
    '<TableCaption>Weekly totals</TableCaption>',
    '<CardTitle className="text-lg">Revenue</CardTitle>',
    '<CardDescription>Last 30 days</CardDescription>',
    '<CardContent>Plain body text</CardContent>',
    '<CardFooter>Updated daily</CardFooter>',
    '<AlertTitle>Heads up</AlertTitle>',
    '<AlertDescription>Numbers are <strong>provisional</strong>, see <a href="https://example.com">the notes</a>.</AlertDescription>',
    '<Badge variant="secondary">New</Badge>',
    '<BreadcrumbLink href="/reports">Reports</BreadcrumbLink>',
    '<BreadcrumbPage>Q3</BreadcrumbPage>',
    '<TableCell>{"lit"} and {7}</TableCell>',
  ])('%s is a text host', (source) => {
    expect(isEditableTextHost(element(source))).toBe(true);
    expect(textLockOf(element(source))).toBeNull();
  });

  it.each([
    ['<TableCell>{$q.rows[0].total}</TableCell>', 'data'],
    ['<TableCell>Total: {$q.rows[0].total}</TableCell>', 'data'],
    ['<CardTitle className={$dark ? "a" : "b"}>Revenue</CardTitle>', 'data'],
    ['<TableCell data-x={1 + 2}>Wed</TableCell>', 'computed'],
    ['<TableCell>Total <Number data="$q" col="total" /></TableCell>', 'data'],
    ['<TableCell>{$_row.name}</TableCell>', 'data'],
    // A <Number> reads data whatever its props say.
    ['<TableCell>Total <Number id={5} suffix="%" /></TableCell>', 'data'],
  ] as const)('%s stays locked: %s', (source, lock) => {
    expect(isEditableTextHost(element(source))).toBe(false);
    expect(kitTextHost(element(source))).toEqual({ editable: false, lock });
    expect(textLockOf(element(source))).toBe(lock);
  });

  it('a kit text component holding a block or another component is a container, not locked text', () => {
    for (const source of ['<CardContent><p>Para</p></CardContent>', '<TableCell><Badge>Done</Badge></TableCell>', '<CardContent>Intro <div>block</div></CardContent>', '<TableCell></TableCell>', '<TableCell>   </TableCell>']) {
      expect(isEditableTextHost(element(source))).toBe(false);
      expect(textLockOf(element(source))).toBeNull();
    }
  });

  it('a container is decided from its children alone, without walking what they hold', () => {
    const cells = Array.from({ length: 50 }, (_, i) => `<TableCell>{$q.rows[${i}].x}</TableCell>`).join('');
    const card = element(`<CardContent><Table><TableBody><TableRow>${cells}</TableRow></TableBody></Table></CardContent>`);
    // Data deep inside a container is the cells' lock, not the container's.
    expect(kitTextHost(card)).toEqual({ editable: false, lock: null });
    expect(textLockOf(card)).toBeNull();
    expect(kitTextHost(element('<TableCell>See <Icon name="check" /></TableCell>'))).toEqual({ editable: false, lock: null });
  });

  it('a link inside a link component is not its text: BreadcrumbLink takes marks but no links', () => {
    expect(isEditableTextHost(element('<BreadcrumbLink href="/a"><strong>Reports</strong></BreadcrumbLink>'))).toBe(true);
    expect(isEditableTextHost(element('<BreadcrumbLink href="/a">See <a href="/b">b</a></BreadcrumbLink>'))).toBe(false);
    expect(kitTextMarkAllowed('BreadcrumbLink', 'a')).toBe(false);
    expect(kitTextMarkAllowed('TableCell', 'a')).toBe(true);
    expect(kitTextMarkAllowed('TableCell', 'div')).toBe(false);
    expect(kitTextMarkAllowed('TableCell', 'img')).toBe(false);
  });

  it('opt-in only: layout shells, controls and components that draw their own content stay locked', () => {
    for (const source of ['<Card>Loose text</Card>', '<CardHeader>Loose</CardHeader>', '<Alert>Loose</Alert>', '<Button>Go</Button>', '<TabsTrigger value="a">A</TabsTrigger>', '<BreadcrumbSeparator>/</BreadcrumbSeparator>', '<Constructor>x</Constructor>'])
      expect(isEditableTextHost(element(source))).toBe(false);
    expect(textLockOf(element('<Button>Go</Button>'))).toBe('component');
    expect(textLockOf(element('<TabsTrigger value="a">A</TabsTrigger>'))).toBe('component');
    expect(textLockOf(element('<Button>{$label}</Button>'))).toBe('data');
    expect(textLockOf(element('<Number data="$q" col="total" />'))).toBe('data');
    // A chart or a table of data shows no text of its own to type into: no lock to explain.
    expect(textLockOf(element('<Question data="$q" />'))).toBeNull();
    expect(textLockOf(element('<Card><CardTitle>T</CardTitle></Card>'))).toBeNull();
  });

  it('plain HTML keeps its own rule, with the reason for text that has none of its own', () => {
    expect(isEditableTextHost(element('<td>Wed</td>'))).toBe(true);
    expect(textLockOf(element('<td>{$q.rows[0].x}</td>'))).toBe('data');
    expect(textLockOf(element('<div><p>x</p></div>'))).toBeNull();
  });
});

describe('one rule for plain HTML text', () => {
  it.each([
    '<p>Hello <strong>bold</strong> and <abbr title="x">abbr</abbr></p>',
    '<p>{"lit"} and {7}</p>',
    '<p>Done <Icon name="circle-check" /> now</p>',
    '<p className={$dark ? "a" : "b"}>Own attributes stay where they are on a text edit</p>',
    '<td>Wed</td>',
  ])('%s is a text host', (source) => {
    expect(isEditableTextHost(element(source))).toBe(true);
    expect(textLockOf(element(source))).toBeNull();
  });

  it.each([
    ['<p>Total: {$x}</p>', 'data'],
    ['<p>Total: {$q.rows[0].total} items</p>', 'data'],
    ['<p>Total: {1 + 2}</p>', 'computed'],
    ['<p>Revenue <Number id={5} suffix="%" /> up</p>', 'data'],
    ['<p>Deep <span><Number data="$q" col="total" /></span> one</p>', 'data'],
    ['<p>See <strong>{$x}</strong> here</p>', 'data'],
    ['<p>Go <a href={$q.rows[0].url}>there</a></p>', 'data'],
    ['<p>Go <a href="$url">there</a></p>', 'data'],
    ['<p>Hi {$show ? "a" : "b"}</p>', 'computed'],
    ['<p>Hi {$show && <strong>there</strong>}</p>', 'computed'],
    ['<p>{$x}</p>', 'data'],
  ] as const)('%s stays locked: %s', (source, lock) => {
    expect(isEditableTextHost(element(source))).toBe(false);
    expect(textHost(element(source))).toEqual({ editable: false, lock });
    expect(textLockOf(element(source))).toBe(lock);
  });

  it('a paragraph holding another component is a container: the component is decided on its own', () => {
    for (const source of ['<p>Chart <Question data="ref:abc123" /> here</p>', '<h1>Status <Badge>live</Badge></h1>', '<h1>Status {$x} <Badge>live</Badge></h1>']) {
      expect(textHost(element(source))).toEqual({ editable: false, lock: null });
      expect(textLockOf(element(source))).toBeNull();
    }
  });

  it('a mark is part of the text it sits in, editable or locked, plain or kit', () => {
    const nodes = (source: string) => parseJsxOrThrow(source).nodes;
    expect(textOwnerPath(nodes('<p>Total {$x} <strong>bold</strong></p>'), '0.2')).toBe('0');
    expect(textOwnerPath(nodes('<p>Hello {"there"} <em><strong>bold</strong></em></p>'), '0.2.0')).toBe('0');
    expect(textOwnerPath(nodes('<CardTitle><b>Net</b> revenue</CardTitle>'), '0.0')).toBe('0');
    expect(textOwnerPath(nodes('<div><p>x <em>y</em></p></div>'), '0.0.1')).toBe('0.0');
    expect(textOwnerPath(nodes('<div><p>x</p></div>'), '0.0')).toBe('0.0');
    // A container's parts are their own.
    expect(textOwnerPath(nodes('<h1>Status <Badge>live <b>now</b></Badge></h1>'), '0.1.1')).toBe('0.1');
  });
});

describe('resolveJsxNodeAtPath', () => {
  const roots = parseJsxOrThrow('<h1>first</h1><div><p>nested</p></div>').nodes;

  it('walks dot-separated indexes into the tree', () => {
    expect(resolveJsxNodeAtPath(roots, '1.0')).toMatchObject({ type: 'element', tag: 'p' });
    expect(resolveJsxNodeAtPath(roots, '9')).toBeNull();
  });

  it('an empty segment names no node: the empty path is not the first root', () => {
    for (const path of ['', '.1', '1.', '1..0']) expect(resolveJsxNodeAtPath(roots, path), JSON.stringify(path)).toBeNull();
  });
});
