import {it,expect} from 'vitest';
import {htmlAssetLinks,rewriteHtmlAssetUrls} from '..';
it('discovers actual byte attributes while excluding backend declarations, scripts and templates',()=>{
 const source='<html><head><link rel="af-backend" href="ref:Back01"><script>const x="ref:Hidden";</script><template><img src="ref:Hidden"></template></head><body><img data-af-id="n1" src="ref:Image1"><a href="ref:File01">File</a><img src="https://example.com/photo.png"></body></html>';
 expect(htmlAssetLinks(source)).toEqual({refs:['Image1','File01'],imageUrls:['https://example.com/photo.png']});
 const rendered=rewriteHtmlAssetUrls(source,new Map([['ref:Image1','/a/Image1/raw?v=2'],['https://example.com/photo.png','/assets/hash']]));
 expect(rendered).toContain('<img data-af-id="n1" src="/a/Image1/raw?v=2">');expect(rendered).toContain('src="/assets/hash"');expect(rendered).toContain('<a href="ref:File01">');expect(source).toContain('src="ref:Image1"');
});
