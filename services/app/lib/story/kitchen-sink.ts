/**
 * The kitchen-sink document: ONE markup doc that
 * instantiates every component in the story registry — the visual regression
 * page, the living component gallery, and the capture/CSP gate subject. The
 * drift test (lib/story/__tests__/kitchen-sink.test.ts) fails the moment a
 * registry component is missing here, the same pattern as the registry-names
 * drift gate.
 *
 * Seeded against a running server by scripts/gate-full-kit.mjs, which creates
 * the dataset/recipe/image refs first and splices their real ids in.
 */

export interface KitchenSinkRefs {
  /** A dataset artifact id (columns: month, region, revenue). */
  dataset: string;
  /** A viz recipe artifact id (slots: x, y, series). */
  recipe: string;
  /** An image artifact id. */
  image: string;
}

export function kitchenSinkMarkup(refs: KitchenSinkRefs): string {
  const ds = `ref_${refs.dataset}`;
  const viz = `ref:${refs.recipe}`;
  const img = `ref:${refs.image}`;
  return `<Helmet>
  <title>The Kitchen Sink</title>
  <Value name="region" type="string" />
  <Value name="min_rev" type="number" default={0} />
  <Value name="since" type="date" default="2026-01-01" />
  <Value name="compare" type="boolean" default={false} />
  <Query name="regions">{\`select distinct region from ${ds} order by 1\`}</Query>
  <Query name="sales">{\`select * from ${ds} where $region is null or region = $region\`}</Query>
</Helmet>
<div data-design="tw" className="@container px-6 py-12 @2xl:px-12">
<header className="max-w-4xl">
  <p className="text-xs uppercase tracking-widest text-muted-foreground">Component gallery</p>
  <h1 className="mt-4 text-5xl @2xl:text-6xl font-bold tracking-tight leading-[1.05]">The Kitchen Sink</h1>
  <p className="mt-6 text-lg text-muted-foreground max-w-prose">Every component the story engine can render, on one page — the visual regression surface and the capture/CSP gate subject.</p>
  <Breadcrumb className="mt-6"><BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="#top">Gallery</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Kitchen sink</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList></Breadcrumb>
</header>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">01 · Surfaces &amp; status</h2>
  <div className="mt-6 grid grid-cols-1 gap-6 @2xl:grid-cols-3">
    <Card>
      <CardHeader>
        <CardTitle>Card title</CardTitle>
        <CardDescription>Card description under the title.</CardDescription>
        <CardAction><Badge>action</Badge></CardAction>
      </CardHeader>
      <CardContent><p className="text-sm">Card content body copy.</p></CardContent>
      <CardFooter><Button size="sm">Card footer button</Button></CardFooter>
    </Card>
    <Card>
      <CardHeader><CardTitle>Status</CardTitle><CardDescription>Badges, progress, skeleton</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2"><Badge>default</Badge><Badge variant="secondary">secondary</Badge><Badge variant="outline">outline</Badge><Badge variant="destructive">destructive</Badge></div>
        <div className="flex items-center gap-2 text-sm"><Icon name="circle-check" /><Icon name="ChartBar" />icons by lucide name</div>
        <Progress value={62} />
        <Skeleton className="h-6 w-2/3" />
      </CardContent>
    </Card>
    <Alert>
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>Alerts render with theme tokens; this one is the default variant.</AlertDescription>
    </Alert>
  </div>
  <div className="mt-6 flex flex-wrap items-center gap-3">
    <Button>Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="destructive">Destructive</Button>
    <AvatarGroup>
      <Avatar><AvatarImage src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%236b7280'/%3E%3C/svg%3E" alt="A" /><AvatarFallback>AB</AvatarFallback><AvatarBadge /></Avatar>
      <Avatar><AvatarFallback>CD</AvatarFallback></Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  </div>
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">02 · Disclosure &amp; navigation</h2>
  <div className="mt-6 grid grid-cols-1 gap-6 @2xl:grid-cols-2">
    <Tabs defaultValue="one">
      <TabsList><TabsTrigger value="one">Tab one</TabsTrigger><TabsTrigger value="two">Tab two</TabsTrigger></TabsList>
      <TabsContent value="one"><p className="mt-3 text-sm">First pane content.</p></TabsContent>
      <TabsContent value="two"><p className="mt-3 text-sm">Second pane content.</p></TabsContent>
    </Tabs>
    <Accordion type="single" collapsible defaultValue="a">
      <AccordionItem value="a"><AccordionTrigger>Accordion section A</AccordionTrigger><AccordionContent>Open by default.</AccordionContent></AccordionItem>
      <AccordionItem value="b"><AccordionTrigger>Accordion section B</AccordionTrigger><AccordionContent>Collapsed until clicked.</AccordionContent></AccordionItem>
    </Accordion>
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="text-sm font-semibold underline underline-offset-2">Toggle details</CollapsibleTrigger>
      <CollapsibleContent><p className="mt-2 text-sm text-muted-foreground">Collapsible content, open by default for the capture.</p></CollapsibleContent>
    </Collapsible>
    <div className="flex items-start gap-8">
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger className="text-sm underline underline-offset-2">Hover target</TooltipTrigger>
          <TooltipContent>Tooltip content (pinned open)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Popover>
        <PopoverAnchor />
        <PopoverTrigger className="text-sm underline underline-offset-2">Popover trigger (click)</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Popover title</PopoverTitle>
            <PopoverDescription>Non-portalling; stays in the captured subtree.</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">03 · Data — declared in Helmet, bound by $name</h2>
  <p className="mt-2 max-w-prose text-muted-foreground">A <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">&lt;Query&gt;</code> over a dataset (SQL, <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">ref_&lt;id&gt;</code>), a <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">&lt;Value&gt;</code> bound to a native select, a recipe and an image artifact by <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">ref:</code>.</p>
  <div className="mt-4"><label className="text-sm text-muted-foreground">Region <select aria-label="Region" className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm" value="$region" options="$regions" /></label></div>
  <div className="mt-6 flex flex-wrap items-end gap-5">
    <Select label="Region (kit)" value="$region" options="$regions" placeholder="All regions" />
    <Segmented label="Region segments" value="$region" options="$regions" />
    <Slider label="Min revenue" value="$min_rev" min={0} max={200} step={10} prefix="$" format=",.0f" />
    <DatePicker label="Since" value="$since" />
    <Switch label="Compare" checked="$compare" />
  </div>
  <p className="mt-4">Filtered revenue: <Number data="$sales" col="revenue" agg="sum" prefix="$" /> across the selection.</p>
  <div className="mt-6 grid grid-cols-1 gap-6 @2xl:grid-cols-2">
    <Card className="h-96"><CardHeader><CardTitle>Vega-lite spec</CardTitle></CardHeader><CardContent className="flex min-h-0 h-72 flex-col">
      <Question title="Revenue by month" data="$sales" viz={{kind:"vega-lite", spec:{mark:"line", encoding:{x:{field:"month", type:"temporal"}, y:{field:"revenue", type:"quantitative"}, color:{field:"region", type:"nominal"}}}}} />
    </CardContent></Card>
    <Card className="h-96"><CardHeader><CardTitle>Recipe artifact</CardTitle></CardHeader><CardContent className="flex min-h-0 h-72 flex-col">
      <Question title="Recipe-materialized" data="$sales" viz={{kind:"recipe", recipe:"${viz}", bindings:{x:"month", y:"revenue", series:"region"}}} />
    </CardContent></Card>
  </div>
  <div className="mt-6 grid grid-cols-1 gap-6 @2xl:grid-cols-2">
    <Card><CardHeader><CardTitle>DataTable</CardTitle></CardHeader><CardContent>
      <DataTable data="$sales" height="320px" sort={{col:"revenue", dir:"desc"}} columns={[{col:"month", title:"Month"}, {col:"region", title:"Region"}, {col:"revenue", title:"Revenue", fmt:"$,.0f", bar:true}]} />
    </CardContent></Card>
    <figure>
      <img src="${img}" alt="Referenced image artifact" className="w-full rounded-md border border-border" />
      <figcaption className="mt-2 text-sm text-muted-foreground">An image artifact resolved from <code className="font-mono text-[0.9em]">ref:</code>.</figcaption>
    </figure>
  </div>
  <Table className="mt-8"><TableCaption>The kit Table family (distinct from the Question table kind).</TableCaption><TableHeader><TableRow><TableHead>Content</TableHead><TableHead>Where it lives</TableHead><TableHead className="text-right">Editor</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>prose</TableCell><TableCell>ordinary HTML tags</TableCell><TableCell className="text-right">WYSIWYG</TableCell></TableRow><TableRow><TableCell>components + HTML</TableCell><TableCell>the document itself</TableCell><TableCell className="text-right">WYSIWYG</TableCell></TableRow></TableBody><TableFooter><TableRow><TableCell>css + js</TableCell><TableCell>&lt;Helmet&gt;</TableCell><TableCell className="text-right">code</TableCell></TableRow></TableFooter></Table>
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">04 · Dashboard grid</h2>
  <Grid className="mt-6">
    <GridItem x={0} y={0} w={4} h={2}><Card className="h-full"><CardHeader><CardDescription>MRR</CardDescription><CardTitle className="text-3xl">$1.18M</CardTitle></CardHeader></Card></GridItem>
    <GridItem x={4} y={0} w={4} h={2}><Card className="h-full"><CardHeader><CardDescription>New logos</CardDescription><CardTitle className="text-3xl">47</CardTitle></CardHeader></Card></GridItem>
    <GridItem x={8} y={0} w={4} h={2}><Card className="h-full"><CardHeader><CardDescription>Churn</CardDescription><CardTitle className="text-3xl">1.9%</CardTitle></CardHeader></Card></GridItem>
    <GridItem x={0} y={2} w={12} h={3}><Card className="h-full"><CardHeader><CardTitle>Grid-hosted chart</CardTitle></CardHeader><CardContent className="flex min-h-0 flex-1 flex-col">
      <Question title="Revenue by region" data="$sales" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{x:{field:"region", type:"nominal"}, y:{field:"revenue", type:"quantitative", aggregate:"sum"}}}}} />
    </CardContent></Card></GridItem>
  </Grid>
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">05 · Prose &amp; typography tags</h2>
  <article className="mt-6 max-w-prose">
    <p className="leading-relaxed">Inline marks: <strong>strong</strong>, <em>emphasis</em>, <u>underline</u>, <s>strike</s>, <mark>mark</mark>, <sub>sub</sub>, <sup>sup</sup>, <kbd>⌘K</kbd>, <abbr title="Content Security Policy">CSP</abbr>, <time>2026-08-09</time>, a <a href="#top" className="underline underline-offset-2">link</a>, and <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">inline code</code>.</p>
    <blockquote className="mt-4 border-l-2 border-foreground pl-4 italic text-muted-foreground">A pulled quote with a <cite>citation</cite>.</blockquote>
    <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted p-4 font-mono text-sm"><code>{\`SELECT region, SUM(revenue) FROM t GROUP BY 1;\`}</code></pre>
    <dl className="mt-4">
      <dt className="font-semibold">Definition term</dt>
      <dd className="text-muted-foreground">Definition description.</dd>
    </dl>
    <details className="mt-4" open>
      <summary className="cursor-pointer font-semibold">Details / summary</summary>
      <p className="mt-2 text-sm text-muted-foreground">Native disclosure, open for the capture.</p>
    </details>
    <hr className="my-6 border-border" />
    <p className="text-sm text-muted-foreground">Line<br />break, and a horizontal rule above.</p>
  </article>
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">06 · Video</h2>
  <Video className="mt-6 max-w-2xl" src="https://www.youtube.com/watch?v=aqz-KE-bpKQ" poster="${img}" title="Big Buck Bunny" />
</section>

<Separator className="my-10" />

<section>
  <h2 className="text-2xl font-semibold tracking-tight">07 · Slides</h2>
  <div className="mt-6 border border-border">
    <SlideDeck>
      <Slide title="Deck cover" className="flex flex-col items-center justify-center gap-4 text-center">
        <Badge>kitchen sink</Badge>
        <h2 className="text-5xl font-bold tracking-tight">A deck inside the gallery</h2>
      </Slide>
      <Slide title="Deck close" className="flex flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-4xl font-semibold">Every component, one page.</h2>
        <p className="text-muted-foreground">SlideDeck and Slide render full-viewport sections.</p>
      </Slide>
    </SlideDeck>
  </div>
</section>
</div>`;
}
