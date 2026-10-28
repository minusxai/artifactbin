/**
 * @template T
 * @param {import('playwright').Page} page
 * @param {() => Promise<unknown>} activate Trusted user action; never synthetic input dispatch.
 * @param {(chooser: import('playwright').FileChooser) => Promise<T>} consume
 * @param {{timeout?: number, diagnostics?: {armed?: boolean, protocolEvents?: unknown[], playwrightEvents?: number}}} [options]
 * @returns {Promise<T>}
 */
export async function withNativeFileChooser(page, activate, consume, options={}) {
  const session=await page.context().newCDPSession(page);
  const diagnostics=options.diagnostics??{};
  diagnostics.armed=false;diagnostics.protocolEvents=[];diagnostics.playwrightEvents=0;
  const observed=()=>{diagnostics.playwrightEvents++;};
  // Keep Playwright's interception subscription alive until setFiles completes. The
  // first listener starts async protocol setup; adding it alone is not an acknowledgement.
  page.on('filechooser',observed);
  session.on('Page.fileChooserOpened',event=>diagnostics.protocolEvents.push({mode:event.mode,backendNodeId:event.backendNodeId}));
  try {
    await session.send('Page.enable',{enableFileChooserOpenedEvent:true});
    // Public Chromium protocol handshake, not a delay or simulated chooser/input event.
    await session.send('Page.setInterceptFileChooserDialog',{enabled:true});
    diagnostics.armed=true;
    const pending=page.waitForEvent('filechooser',{timeout:options.timeout??2000});
    const [chooser]=await Promise.all([pending,activate()]);
    return await consume(chooser);
  } finally {
    try {await session.send('Page.setInterceptFileChooserDialog',{enabled:false});}
    finally {page.off('filechooser',observed);await session.detach();}
  }
}
