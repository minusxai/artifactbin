/** Archived pages own a complete design system. Keep platform styles outside
 * their cascade while following reader mode; navigation paths are not node IDs. */
export const archivedOutlineNavigation: string = `<script>(()=>{
const root=document.documentElement;
const preserveDesign=()=>{for(const sheet of document.querySelectorAll('link[data-af="design-system"],style[data-af="design-system"]')){sheet.disabled=true;if(sheet.media!=='not all')sheet.media='not all';}};
new MutationObserver(preserveDesign).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['href','media']});preserveDesign();
const appearance=()=>{if(!root.hasAttribute('data-af-design-system'))return;const dark=root.getAttribute('data-af-dark')==='true';for(const node of [root,...document.querySelectorAll('[data-mx-inline-story]')]){node.classList.toggle('dark',dark);node.classList.toggle('light',!dark);}};
new MutationObserver(appearance).observe(root,{attributes:true,attributeFilter:['data-af-dark','data-af-design-system']});appearance();
const rows=()=>[...document.querySelectorAll('.mx-outline-row[data-mx-target]')];
const heading=row=>{const [path,index]=row.getAttribute('data-mx-target').split(':md:');const host=[...document.querySelectorAll('.mx-doc [data-af-outline-path]')].find(node=>node.getAttribute('data-af-outline-path')===path);return index===undefined?host:host?.querySelector('[data-mx-markdown-heading="'+CSS.escape(index)+'"]');};
const mark=()=>{const list=rows();let active=0;list.forEach((row,i)=>{const target=heading(row);if(target&&target.getBoundingClientRect().top<=innerHeight/3)active=i;});list.forEach((row,i)=>{if(i===active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});};
document.addEventListener('click',event=>{const row=event.target.closest?.('.mx-outline-row[data-mx-target]');if(row)heading(row)?.scrollIntoView({behavior:'smooth',block:'start'});});
addEventListener('scroll',mark,{passive:true});addEventListener('resize',mark);mark();
})();</script>`;
