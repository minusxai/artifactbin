/** Shared manual demo and deterministic browser-gate document. No external services. */
export const commentTargetsMarkup = `<Helmet>
  <title>Comments across dynamic content</title>
  <Value name="flags" type="table" value={[{"reverse":false}]}/>
  <Value name="orders" type="table" value={[{"order_id":"order-101","customer":"Alice Chen","status":"Ready"},{"order_id":"order-102","customer":"Bob Singh","status":"Review"},{"order_id":"order-103","customer":"Carla Diaz","status":"Ready"}]}/>
  <Query name="ordered">{\`select o.* from orders o, flags f order by case when f.reverse then o.customer end desc, o.customer asc\`}</Query>
  <Mutation name="reverseRows">{\`update flags set reverse = not reverse\`}</Mutation>
  <Mutation name="renameAlice">{\`update orders set customer='Alice Chen — updated' where order_id='order-101'\`}</Mutation>
  <Mutation name="removeAlice">{\`delete from orders where order_id='order-101'\`}</Mutation>
  <Mutation name="restoreAlice">{\`insert into orders select 'order-101', 'Alice Chen', 'Ready' where not exists (select 1 from orders where order_id='order-101')\`}</Mutation>
</Helmet>
<main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
  <header className="space-y-3">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Comment interaction demo</p>
    <h1 className="text-3xl @2xl:text-4xl font-semibold tracking-tight">Comments that follow the item</h1>
    <p id="intro" className="text-muted-foreground max-w-prose">Use Select to click a block or drag an area. Select words to comment on text. Open a saved comment, then reorder, rebuild, or remove its item.</p>
  </header>
  <section className="space-y-4">
    <h2 id="rows-heading" className="text-2xl font-semibold">1. Rows in JSX</h2>
    <p className="text-muted-foreground">These controls update both the repeated cards and the table. A comment should follow the order key, regardless of position or customer name.</p>
    <div className="flex flex-wrap gap-2">
      <Button run="$reverseRows">Reverse JSX rows</Button><Button run="$renameAlice">Rename JSX Alice</Button><Button run="$removeAlice">Remove JSX Alice</Button><Button run="$restoreAlice">Restore JSX Alice</Button>
    </div>
    <For id="order-cards" each={$ordered} keyBy="order_id">
      <article id="order-card" className="border border-border rounded-lg p-4 space-y-1">
        <p id="order-customer" className="font-semibold">{$_row.customer}</p>
        <p id="order-status" className="text-muted-foreground">{$_row.status}</p>
      </article>
    </For>
    <DataTable id="order-table" data="$ordered" rowKey="order_id" height="260px" columns={[{"col":"customer","title":"Customer"},{"col":"status","title":"Status"}]}/>
  </section>
  <section className="space-y-3">
    <h2 className="text-2xl font-semibold">2. Try the lifecycle</h2>
    <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
      <li>Open comments and select a repeated card and a table cell.</li>
      <li>Save a comment, then hover its sidebar entry to highlight the matching content.</li>
      <li>Reorder and rebuild. The comment should stay with the same item.</li>
      <li>Remove the item, then restore it. The owner remains available while the item is missing.</li>
      <li>Reload. Stable IDs and keys reconnect; temporary node handles do not.</li>
      <li>On mobile, try text selection and Select mode.</li>
    </ol>
  </section>
  <section className="space-y-3">
    <h2 className="text-2xl font-semibold">3. A list without keyBy</h2>
    <p>This list renders by position. Comments stay on the whole list when rows move; add keyBy to make comments follow individual items.</p>
    <For id="index-cards" each={$ordered} className="space-y-2">
      <p id="index-customer" className="rounded border p-3">{$_row.customer}</p>
    </For>
  </section>
</main>`;
