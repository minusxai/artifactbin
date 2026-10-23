/** Archived navigation addresses are separate from persistent node identities. */
export const archivedOutlineNavigation: string = `<script>(()=>{
const rows=()=>[...document.querySelectorAll('.mx-outline-row[data-mx-target]')];
const heading=row=>{const [path,index]=row.getAttribute('data-mx-target').split(':md:');const host=[...document.querySelectorAll('.mx-doc [data-af-outline-path]')].find(node=>node.getAttribute('data-af-outline-path')===path);return index===undefined?host:host?.querySelector('[data-mx-markdown-heading="'+CSS.escape(index)+'"]');};
const mark=()=>{const list=rows();let active=0;list.forEach((row,i)=>{const target=heading(row);if(target&&target.getBoundingClientRect().top<=innerHeight/3)active=i;});list.forEach((row,i)=>{if(i===active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});};
document.addEventListener('click',event=>{const row=event.target.closest?.('.mx-outline-row[data-mx-target]');if(row)heading(row)?.scrollIntoView({behavior:'smooth',block:'start'});});
addEventListener('scroll',mark,{passive:true});addEventListener('resize',mark);mark();
})();</script>`;
