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
 await page.getByRole('button',{name:'Create document',exact:true}).click();
 await page.waitForURL(url=>!url.pathname.startsWith('/documents/')&&url.hash==='#edit');
 const id=new URL(page.url()).pathname.match(/\/([A-Za-z0-9]{6})(?:-|$)/)[1];
 const head=()=>page.evaluate(async id=>(await fetch(`/api/documents/${id}`)).json(),id);
 const save=async(action)=>{const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/api/documents/${id}`);await action();assert.equal((await response).status(),200);await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();};
 const initial=await head();const iframeId=initial.document.nodes[initial.document.rootId].children[3];
 const block=page.locator(`[data-node-id="${iframeId}"]`);
 const blockGrip=block.locator(':scope > .mdx-container-controls').getByRole('button',{name:'Select container',exact:true});
 await blockGrip.click();
 await save(()=>page.getByLabel('Component width',{exact:true}).fill('320'));
 await save(()=>page.getByLabel('Float component',{exact:true}).selectOption('left'));
 assert.equal((await head()).document.nodes[iframeId].props.float,'left');
 const handle=block.locator(':scope > .mdx-container-controls').getByRole('button',{name:'Resize container',exact:true});await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
 await save(async()=>{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+30,{steps:6});await page.mouse.up();});
 assert.ok((await head()).document.nodes[iframeId].props.width>320);
 // Shrinking a previously sized styled block updates its painted content before pointer-up.
 await save(()=>page.getByLabel('Component height',{exact:true}).fill('420'));
 const bottom=block.locator(':scope > .mdx-container-controls').getByRole('button',{name:'Resize container height',exact:true});
 await bottom.scrollIntoViewIfNeeded();const bottomBox=await bottom.boundingBox();const beforeHeight=(await block.boundingBox()).height;
 await save(async()=>{
  await page.mouse.move(bottomBox.x+bottomBox.width/2,bottomBox.y+bottomBox.height/2);await page.mouse.down();
  await page.mouse.move(bottomBox.x+bottomBox.width/2,bottomBox.y+bottomBox.height/2-80,{steps:6});
  assert.ok((await block.boundingBox()).height<beforeHeight-60,'Styled block must visibly shrink during dragging');
  await page.mouse.up();
 });

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
 assert.equal(await layout.locator('.mdx-layout-divider').isVisible(),false,'Only selecting Flex exposes its divider hit area');
 await layout.getByRole('button',{name:'Select container',exact:true}).nth(1).click();
 assert.equal(await page.locator('.ProseMirror-selectednode').getAttribute('data-node-id'),initial.document.nodes[flexId].children[1],'Right-hand grip must not be intercepted by a divider');
 assert.equal(await page.locator('.ProseMirror-selectednode').evaluate(el=>getComputedStyle(el,'::selection').backgroundColor),'rgba(0, 0, 0, 0)');
 await layout.getByRole('button',{name:'Select container',exact:true}).first().click();

 await save(()=>page.getByLabel('Width of parent (%)',{exact:true}).fill('35'));
 const shares=(await head()).document.nodes[flexId].props.sizes;
 assert.ok(Math.abs(shares[0]/(shares[0]+shares[1])-.35)<.001,'Typing 35% must retain both digits');

 // Select a range, apply a font, switch to source and edit prose without losing its identity.
 await page.locator('.ProseMirror > p').first().evaluate(p=>{const range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,5);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await save(()=>page.getByLabel('Text font',{exact:true}).selectOption('font-mono'));
 const styled=await head();const paragraphId=styled.document.nodes[styled.document.rootId].children[1];
 assert.ok(styled.document.nodes[paragraphId].content.some(run=>run.marks?.some(mark=>mark.attrs?.className==='font-mono')));
 await page.getByRole('button',{name:'Edit the source',exact:true}).click();const source=page.getByRole('textbox',{name:'MDX source',exact:true});await source.fill(`${await source.inputValue()}\n\nAn added paragraph from source.\n`);
 await save(()=>page.getByRole('button',{name:'Apply MDX',exact:true}).click());
 assert.deepEqual((await head()).document.nodes[paragraphId],styled.document.nodes[paragraphId]);
 await page.reload();await page.getByRole('textbox',{name:'Document editor',exact:true}).waitFor();assert.ok(await page.getByRole('textbox',{name:'Document editor',exact:true}).getByText('An added paragraph from source.',{exact:true}).isVisible());
 assert.equal((await head()).document.nodes[iframeId].props.float,'left');
 // A native drag needs a dragover after dragstart, including across the iframe boundary.
 await blockGrip.scrollIntoViewIfNeeded();
 await save(async()=>{
  const from=await blockGrip.boundingBox(),to=await page.getByRole('heading',{name:'Room for an idea',exact:true}).boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  const selected=await blockGrip.boundingBox();assert.ok(Math.abs(selected.y-from.y)<1,'Selection must not shift the canvas under the drag pointer');
  await page.mouse.move(from.x+from.width/2+10,from.y+from.height/2+10,{steps:3});
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
  await page.mouse.move(to.x+to.width/2+1,to.y+to.height/2+1);
  await page.locator('.mdx-drop-marker:not([hidden])').waitFor();
  assert.equal(await page.locator('.mdx-container.ProseMirror-selectednode').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.mouse.up();
 });
 const moved=await head();const column=moved.document.nodes[flexId].children[0];assert.ok(moved.document.nodes[column].children.includes(iframeId),'Dragging moves the same component identity into the column');
 const currentVersion=moved.version;
 await page.getByRole('button',{name:`Preview version ${currentVersion-1}`,exact:true}).click();
 await page.getByRole('status').filter({hasText:`Previewing v${currentVersion-1}`}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Document editor',exact:true}).getAttribute('contenteditable'),'false');
 assert.equal((await head()).version,currentVersion,'Preview must not save');
 await page.getByRole('button',{name:'Show the current version',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Document editor',exact:true}).getAttribute('contenteditable'),'true');
 await page.getByRole('button',{name:'Exit edit mode',exact:true}).click();await page.waitForURL(url=>url.hash!=='#edit');
 assert.equal(await page.getByRole('textbox',{name:'Document editor',exact:true}).count(),0);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Document editor',exact:true}).waitFor();

 // Exercise the actual supplied website as MDX, not a simplified approximation.
 await page.goto(`${base}/documents/new?example=case-study`);
 await page.getByRole('button',{name:'Create document',exact:true}).click();await page.waitForURL(url=>!url.pathname.startsWith('/documents/')&&url.hash==='#edit');
 await page.getByRole('textbox',{name:'Document editor',exact:true}).waitFor();
 const demoId=new URL(page.url()).pathname.match(/\/([A-Za-z0-9]{6})(?:-|$)/)[1];
 const demoHead=()=>page.evaluate(async id=>(await fetch(`/api/documents/${id}`)).json(),demoId);
 await page.locator('.ProseMirror #title').waitFor();
 assert.equal((await page.locator('.ProseMirror #title').innerText()).trim(),'How We Built\nAI-Powered Pitch Training\nfor cult Centre Managers');
 assert.equal(await page.locator('.ProseMirror .case-study').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(3, 6, 28)');
 assert.equal(await page.locator('.ProseMirror .mdx-container-content').count(),0,'Canvas must preserve direct-child website CSS');
 // Crossing the gutter must not retarget the handle to a large layout ancestor.
 const demoParagraph=page.locator('.ProseMirror #h2WU');await demoParagraph.scrollIntoViewIfNeeded();
 const paragraphBox=await demoParagraph.boundingBox();
 await page.mouse.move(paragraphBox.x+30,paragraphBox.y+10);await page.mouse.move(paragraphBox.x-5,paragraphBox.y+10,{steps:5});
 const blockGrip=page.getByRole('button',{name:'Select block',exact:true});assert.equal(await blockGrip.isVisible(),true);
 await blockGrip.click();assert.equal(await page.locator('.ProseMirror-selectednode').getAttribute('id'),'h2WU');
 await blockGrip.dispatchEvent('dragstart',{dataTransfer:await page.evaluateHandle(()=>new DataTransfer())});
 const dragCopy=page.locator('[data-mdx-drag-preview]');const dragBox=await dragCopy.boundingBox();
 assert.ok(dragBox.width<=361&&dragBox.height<=241,'Drag copy must be bounded independently of page zoom');
 assert.equal(await dragCopy.textContent(),await demoParagraph.textContent());
 assert.equal(await dragCopy.locator('[data-node-id]').count(),0);
 await blockGrip.dispatchEvent('dragend');assert.equal(await dragCopy.count(),0);
 const demoBefore=await demoHead();
 const prose=page.locator('.ProseMirror #h2WU');await prose.scrollIntoViewIfNeeded();
 await prose.evaluate(p=>{const range=document.createRange();range.setStart(p.firstChild,12);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);p.closest('.ProseMirror').focus();});
 const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/api/documents/${demoId}`);
 await page.keyboard.press('Shift+Enter');assert.equal((await saved).status(),200);
 await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();
 const demoAfter=await demoHead();assert.equal(demoAfter.document.nodes.h2WU.content.filter(run=>run.type==='break').length,1);
 assert.equal(Object.keys(demoAfter.document.nodes).length,Object.keys(demoBefore.document.nodes).length,'A line break must retain the paragraph and node identities');
 await page.reload();await page.locator('.ProseMirror #h2WU br').waitFor({state:'attached'});
 assert.ok((await page.locator('.ProseMirror #h2WU').innerText()).includes('\n'),'The saved break must split the rendered paragraph');
 await page.getByRole('button',{name:'Exit edit mode',exact:true}).click();await page.waitForURL(url=>url.hash!=='#edit');
 assert.equal((await page.locator('[data-mx-inline-story] #title').innerText()).trim(),'How We Built\nAI-Powered Pitch Training\nfor cult Centre Managers');
 console.log('ok MDX gestures, preserved history, exact website canvas, line breaks, save and reload');

}finally{await browser.close();}
