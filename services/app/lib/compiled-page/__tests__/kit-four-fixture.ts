/**
 * Fixtures for the compile-time kit chunks (static-html.test.ts, and the before/after timing in the PR report): every
 * kit component the compiler pre-renders beside the tables — static Grid/GridItem (positioned and flow), static
 * Buttons, Files, a static deck of Slides — around one live value, and the 28-kit-table report.
 */
const grid = (g: number) => `<Grid className="mt-6" id="g${g}"><GridItem x={0} y={0} w={6} h={2} id="g${g}a"><Card className="h-full" id="g${g}b"><CardTitle id="g${g}c">Tile ${g}</CardTitle><CardContent id="g${g}d">Body &amp; text</CardContent></Card></GridItem>`
  + `<GridItem x={6} y={0} w={6} h={3} className="bg-muted" style={{padding: 4}} id="g${g}e"><p id="g${g}f">B ${g}</p><Button variant="outline" size="sm" id="g${g}g">Open</Button></GridItem></Grid>`
  + `<Grid mode="flow" cols={3} rowHeight={40} id="f${g}"><GridItem w={2} minHeight={120} id="f${g}a"><Badge id="f${g}b">x</Badge></GridItem><GridItem w={1} id="f${g}c">text</GridItem><p id="f${g}d">stray</p></Grid>`;
const media = (m: number) => `<File src="https://example.com/r${m}.pdf" title="Report ${m}" className="max-w-2xl" id="v${m}a" />`
  + `<File src="https://example.com/s${m}.pdf" bytes="2048" pages="2" id="v${m}b" /><File src="ref:NOPE" id="v${m}c" />`
  + `<Button id="b${m}a">Primary</Button><Button variant="ghost" size="sm" className="ml-2" id="b${m}b">Ghost</Button><Button disabled type="submit" id="b${m}c">Off</Button>`;
const slide = (s: number) => `<Slide title="Slide ${s}" className="py-10" id="s${s}"><h2 id="s${s}h">Slide ${s}</h2>${media(s)}${grid(s)}</Slide>`;

/** The four kit families pre-rendered: a static deck of six slides, each with grids, buttons and file cards, and one live value outside it. */
export const KIT_FOUR_MARKUP = '<Helmet><Value name="who" type="string" default="Ada" /></Helmet>'
  + '<div data-design="tw" className="px-6" id="root"><p id="hi">Hi {$who}</p>'
  + `<SlideDeck id="deck">${Array.from({ length: 6 }, (_, s) => slide(s)).join('')}</SlideDeck>${grid(9)}${media(9)}</div>`;

const cell = (t: number, r: number, c: number, body: string, cls = '') => `<TableCell${cls ? ` className="${cls}"` : ''} id="c${t}_${r}_${c}">${body}</TableCell>`;
const row = (t: number, r: number) => `<TableRow id="r${t}_${r}">${cell(t, r, 0, `Item ${r} golf`)}${cell(t, r, 1, String(r * 17), 'text-right tabular-nums')}${cell(t, r, 2, `<Badge variant="secondary" id="b${t}_${r}">ok</Badge>`)}${cell(t, r, 3, `note ${r} with <strong>bold</strong> &amp; text`)}</TableRow>`;
const table = (t: number) => `<h2 className="mt-8 text-xl font-semibold" id="h${t}">Section ${t}</h2><p className="text-sm text-muted-foreground" id="p${t}">Notes for ${t}: alpha &amp; beta.</p>`
  + `<Card id="k${t}"><CardContent id="kc${t}"><Table id="t${t}"><TableHeader id="th${t}"><TableRow id="tr${t}">${['Name', 'Value', 'State', 'Notes'].map((h, i) => `<TableHead id="hd${t}_${i}">${h}</TableHead>`).join('')}</TableRow></TableHeader>`
  + `<TableBody id="tb${t}">${Array.from({ length: 30 }, (_, r) => row(t, r)).join('')}</TableBody></Table></CardContent></Card>`;
/** 28 kit Tables × 30 rows and a chart (static-html.test's kit-table report). */
export const KIT_REPORT_MARKUP = `<Helmet><Import name="sales" src="ref:SALES1" /><Query name="monthly">{\`select month, sum(revenue) as revenue from sales.rows group by 1 order by 1\`}</Query></Helmet>`
  + `<div data-design="tw" className="px-6" id="root"><h1 className="text-3xl font-bold" id="title">Report</h1>`
  + `<Question title="Revenue" data="$monthly" height="300px" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} id="q1" />`
  + `${Array.from({ length: 28 }, (_, t) => table(t)).join('')}</div>`;
