/** This wrapper precedes every authored node, so no provisional guest branch can flash. */
export function viewerContentHtml(body:string,unavailable=false):string{
 return '<p role="status" data-migration-viewer-status>'+ (unavailable?'Reader identity is unavailable in this saved page.':'Loading reader identity…')+'</p><div data-migration-viewer-content hidden inert style="display:none!important">'+body+'</div>';
}
