/** The caller supplies one pinned allowlisted module, never derive URLs from markup. */
/** @param {import("./contracts.js").LoaderOptions} options
 * @returns {import("./contracts.js").Loader} */
export function start({sourceCaptured,load}){
 /** @type {import('./contracts.js').Loader['status']} */
 let status='idle';let attempts=0;
 /** @type {Promise<void> | undefined} */
 let pending;
 const ensure=()=>{
  if(status==='ready'||pending||attempts>=2)return pending??Promise.resolve();
  attempts++;status='loading';
  pending=Promise.resolve().then(()=>load(attempts)).then(module=>{
   // Import/evaluation success is separate from registration. No automatic retry loop.
   module.register({sourceCaptured});status='ready';
  }).catch(()=>{status='failed'}).finally(()=>{pending=undefined});return pending;
 };
 /** @param {Node} node */
 const has=node=>node instanceof Element&&(node.matches('af-markdown')||node.querySelector('af-markdown'));
 const observer=new MutationObserver(records=>{
  if(status==='idle'&&records.some(r=>[...r.addedNodes].some(has)))ensure();
 });
 const begin=()=>{if(document.querySelector('af-markdown'))ensure();observer.observe(document.documentElement,{childList:true,subtree:true})};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});else begin();
 return {get status(){return status},retry(){return status==='failed'?ensure():Promise.resolve()},disconnect(){observer.disconnect();document.removeEventListener('DOMContentLoaded',begin)}};
}
