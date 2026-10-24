/** Browser-only readiness probe for the timing lab. Marks useful fixture content after two paint opportunities.
 * Self-contained: Playwright serializes this function into each newly loaded frame. */
export function installPerformanceUsefulObserver() {
  window.__performanceUseful = null;
  const mark = () => { if(window.__performanceUseful===null) requestAnimationFrame(() => requestAnimationFrame(() => { window.__performanceUseful=performance.now(); })); };
  window.addEventListener('message',event=>{const frame=document.querySelector('iframe[data-mx-document-frame]');if(frame && event.source===frame.contentWindow && event.data?.type==='page-speed-useful')mark();});
  const observer = new MutationObserver(() => {
    const home = location.pathname === '/' && document.querySelector('a[href^="/a/"][aria-label^="Open Workspace sample "]') !== null;
    const prose = [...document.querySelectorAll('h1')].some(h => h.textContent === 'Performance fixture');
    if (!home && !prose) return;
    observer.disconnect();
    if(window.parent!==window)window.parent.postMessage({type:'page-speed-useful'},'*');else mark();
  });
  observer.observe(document, { subtree: true, childList: true });
}
