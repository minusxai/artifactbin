/** Shared manual demo and deterministic browser-gate document. No external services. */
const iframeScript = String.raw`
const initial = [
  {id:'order-101',customer:'Alice Chen',status:'Ready'},
  {id:'order-102',customer:'Bob Singh',status:'Review'},
  {id:'order-103',customer:'Carla Diaz',status:'Ready'}
];
let rows=initial.map(row=>({...row})), revision=0;
const host=document.getElementById('dynamic-orders');
function render(){
  host.replaceChildren();
  for(const row of rows){
    const article=document.createElement('article');
    article.setAttribute('data-comment-key',row.id);
    const name=document.createElement('p');
    name.setAttribute('data-comment-key','customer');name.className='customer';name.textContent=row.customer;
    const status=document.createElement('p');
    status.setAttribute('data-comment-key','status');status.textContent=row.status;
    article.append(name,status);host.append(article);
  }
  document.getElementById('revision').textContent='Render '+(++revision);
}
document.getElementById('reverse').addEventListener('click',()=>{rows.reverse();render();});
document.getElementById('rebuild').addEventListener('click',render);
document.getElementById('rename').addEventListener('click',()=>{const row=rows.find(row=>row.id==='order-101');if(row)row.customer='Alice Chen — updated';render();});
document.getElementById('remove').addEventListener('click',()=>{rows=rows.filter(row=>row.id!=='order-101');render();});
document.getElementById('restore').addEventListener('click',()=>{rows=initial.map(row=>({...row}));render();});
document.getElementById('duplicate').addEventListener('click',()=>{rows.push({...initial[0]});render();});
function replaceTemporary(){
  const node=document.createElement('p');node.textContent='Temporary note: this element has no stable key.';
  document.getElementById('temporary-host').replaceChildren(node);
}
document.getElementById('replace-temporary').addEventListener('click',replaceTemporary);
replaceTemporary();
render();
`;

export const commentTargetsMarkup = `<Helmet>
  <title>Comments across dynamic content</title>
  <Value name="reverse" type="boolean" default={false}/>
  <Value name="orders" type="table" value={[{"order_id":"order-101","customer":"Alice Chen","status":"Ready"},{"order_id":"order-102","customer":"Bob Singh","status":"Review"},{"order_id":"order-103","customer":"Carla Diaz","status":"Ready"}]}/>
  <Query name="ordered">{\`select * from orders order by case when $reverse then customer end desc, customer asc\`}</Query>
  <Mutation name="reverseRows">{\`update _signals set reverse=not reverse\`}</Mutation>
  <Mutation name="renameAlice">{\`update orders set customer='Alice Chen — updated' where order_id='order-101'\`}</Mutation>
  <Mutation name="removeAlice">{\`delete from orders where order_id='order-101'\`}</Mutation>
  <Mutation name="restoreAlice">{\`insert into orders select 'order-101', 'Alice Chen', 'Ready' where not exists (select 1 from orders where order_id='order-101')\`}</Mutation>
</Helmet>
<main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
  <header className="space-y-3">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Comment interaction demo</p>
    <h1 className="text-3xl @2xl:text-4xl font-semibold tracking-tight">Comments that follow the item</h1>
    <p className="text-muted-foreground max-w-prose">Use Select to click a block or drag an area. Select words to comment on text. Open a saved comment, then reorder, rebuild, or remove its item.</p>
  </header>
  <section className="space-y-4">
    <h2 className="text-2xl font-semibold">1. Inside an iframe</h2>
    <p className="text-muted-foreground">Comment on Alice below. Reverse and Rebuild should keep the highlight on Alice. Remove should retain the iframe as the fallback. Restore should reconnect it. Duplicate key should never pick a row arbitrarily.</p>
    <Iframe id="iframe-orders" title="Dynamic comment playground" height={560}>
      <style>{\`html{color-scheme:light dark}body{font:15px/1.5 system-ui;background:light-dark(#fafaf9,#1c1c1b);color:light-dark(#292524,#e7e5e4);padding:20px;box-sizing:border-box}h3{font-size:20px;margin:0 0 8px}p{margin:4px 0}nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}button{font:inherit;padding:6px 10px;border:1px solid #78716c;border-radius:5px;cursor:pointer;background:transparent;color:inherit}button:focus-visible{outline:2px solid #d97706}article{border:1px solid #78716c;border-radius:6px;padding:12px;margin:10px 0}.customer{font-weight:600}small{opacity:.7}\`}</style>
      <h3 id="static-iframe-heading">Orders in a separate document</h3>
      <p id="static-iframe-text">This static paragraph has a persistent source ID. Select these words to try a text comment.</p>
      <nav aria-label="Change iframe rows">
        <button id="reverse">Reverse rows</button><button id="rebuild">Rebuild rows</button><button id="rename">Rename Alice</button><button id="remove">Remove Alice</button><button id="restore">Restore rows</button><button id="duplicate">Duplicate key</button>
      </nav>
      <small id="revision" aria-live="polite">Starting</small>
      <div id="dynamic-orders"></div>
      <div id="temporary-host"></div>
      <button id="replace-temporary">Replace temporary note</button>
      <script>{${JSON.stringify(iframeScript)}}</script>
    </Iframe>
  </section>
  <section className="space-y-4">
    <h2 className="text-2xl font-semibold">2. The same rows in JSX</h2>
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
    <h2 className="text-2xl font-semibold">3. Try the lifecycle</h2>
    <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
      <li>Open comments and select a target inside the iframe, a repeated card, and a table cell.</li>
      <li>Save a comment, then hover its sidebar entry to highlight the matching content.</li>
      <li>Reorder and rebuild. The comment should stay with the same item.</li>
      <li>Remove the item, then restore it. The owner remains available while the item is missing.</li>
      <li>Reload. Stable IDs and keys reconnect; temporary node handles do not.</li>
      <li>On mobile, try text selection, Select mode, and a long press inside the iframe.</li>
    </ol>
  </section>
</main>`;
