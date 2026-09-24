/** CI-only: the complete inline MDX editing gesture/save/reload loop. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {becomeOwner,startDocument} from './lib/start-doc.mjs';
const base=process.argv[2]??'http://localhost:3030';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:1200}});
 const start=await startDocument(base);await becomeOwner(page,base,start.token);
 await page.goto(`${base}/documents/new`);
 await page.getByLabel('Document title',{exact:true}).fill('MDX browser proof');
 await page.getByRole('button',{name:'Save document',exact:true}).click();
 await page.waitForURL(/\/documents\/(?!new)[A-Za-z0-9]+$/);
 const id=new URL(page.url()).pathname.split('/').at(-1);
 const head=()=>page.evaluate(async id=>(await fetch(`/api/documents/${id}`)).json(),id);
 const save=async(action)=>{const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/api/documents/${id}`);await action();assert.equal((await response).status(),200);await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();};
 const initial=await head();const iframeId=Object.keys(initial.document.nodes).find(id=>initial.document.nodes[id].name==='Iframe');
 await page.getByRole('button',{name:'Select Iframe',exact:true}).click();
 await save(()=>page.getByLabel('Component width',{exact:true}).fill('320'));
 await save(()=>page.getByLabel('Float component',{exact:true}).selectOption('left'));
 assert.equal((await head()).document.nodes[iframeId].props.float,'left');
 const handle=page.getByRole('button',{name:'Resize component',exact:true});await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
 await save(async()=>{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+30,{steps:6});await page.mouse.up();});
 assert.ok((await head()).document.nodes[iframeId].props.width>320);
 await page.getByRole('button',{name:'Select Flex',exact:true}).click();
 const flexId=Object.keys(initial.document.nodes).find(id=>initial.document.nodes[id].name==='Flex');
 const divider=page.getByRole('button',{name:'Resize layout divider 1',exact:true});await divider.scrollIntoViewIfNeeded();const dividerBox=await divider.boundingBox();
 await save(async()=>{await page.mouse.move(dividerBox.x+dividerBox.width/2,dividerBox.y+dividerBox.height/2);await page.mouse.down();await page.mouse.move(dividerBox.x+dividerBox.width/2-60,dividerBox.y+dividerBox.height/2,{steps:6});await page.mouse.up();});
 assert.notDeepEqual((await head()).document.nodes[flexId].props.sizes,[2,1]);
 const layout=page.locator(`[data-node-id="${flexId}"]`),controls=page.locator(`[data-node-id="${flexId}"] > .mdx-container-controls`);
 const geometry=await layout.evaluate(el=>{const [a,b]=el.querySelector('.mdx-container-content').children,A=a.getBoundingClientRect(),B=b.getBoundingClientRect(),D=el.querySelector('.mdx-layout-divider').getBoundingClientRect();return {gap:(A.right+B.left)/2,handle:D.left+D.width/2};});
 assert.ok(Math.abs(geometry.gap-geometry.handle)<3,'Divider must sit between the children');
 const ratios=(await head()).document.nodes[flexId].props.sizes;
 await save(()=>controls.getByRole('button',{name:'Resize container width',exact:true}).press('ArrowLeft'));
 assert.deepEqual((await head()).document.nodes[flexId].props.sizes,ratios,'Resizing the parent must preserve child shares');
 await layout.getByRole('button',{name:'Select container',exact:true}).first().click();
 await save(()=>page.getByLabel('Width of parent (%)',{exact:true}).fill('35'));
 const shares=(await head()).document.nodes[flexId].props.sizes;
 assert.ok(Math.abs(shares[0]/(shares[0]+shares[1])-.35)<.001,'Typing 35% must retain both digits');

 // Select a range, apply a font, switch to source and edit prose without losing its identity.
 await page.locator('.ProseMirror > p').first().evaluate(p=>{const range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,5);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await save(()=>page.getByLabel('Text font',{exact:true}).selectOption('font-mono'));
 const styled=await head();const paragraphId=styled.document.nodes[styled.document.rootId].children[1];
 assert.ok(styled.document.nodes[paragraphId].content.some(run=>run.marks?.some(mark=>mark.attrs?.className==='font-mono')));
 await page.getByRole('button',{name:'MDX source',exact:true}).click();const source=page.getByRole('textbox',{name:'MDX source',exact:true});await source.fill(`${await source.inputValue()}\n\nAn added paragraph from source.\n`);
 await save(()=>page.getByRole('button',{name:'Apply MDX',exact:true}).click());
 assert.deepEqual((await head()).document.nodes[paragraphId],styled.document.nodes[paragraphId]);
 await page.reload();await page.getByRole('textbox',{name:'Document editor',exact:true}).waitFor();assert.ok(await page.getByText('An added paragraph from source.',{exact:true}).isVisible());
 assert.equal((await head()).document.nodes[iframeId].props.float,'left');
 // A native drag needs a dragover after dragstart, including across the iframe boundary.
 await page.getByRole('button',{name:'Select Iframe',exact:true}).scrollIntoViewIfNeeded();
 await save(async()=>{
  const from=await page.getByRole('button',{name:'Select Iframe',exact:true}).boundingBox(),to=await page.getByRole('heading',{name:'Room for an idea',exact:true}).boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  const selected=await page.getByRole('button',{name:'Select Iframe',exact:true}).boundingBox();assert.ok(Math.abs(selected.y-from.y)<1,'Selection must not shift the canvas under the drag pointer');
  await page.mouse.move(from.x+from.width/2+10,from.y+from.height/2+10,{steps:3});
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
  await page.mouse.move(to.x+to.width/2+1,to.y+to.height/2+1);await page.mouse.up();
 });
 const moved=await head();const column=moved.document.nodes[flexId].children[0];assert.ok(moved.document.nodes[column].children.includes(iframeId),'Dragging moves the same component identity into the column');
 console.log('ok MDX inline range fonts, dimensions, float, pointer resizing, source identities and saved reload');
}finally{await browser.close();}
