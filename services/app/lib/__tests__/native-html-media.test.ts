import {expect,it,vi} from 'vitest';
import {packOfflineHtmlImages,OfflineHtmlMediaError} from '../export/native-html-media';
const html='<html><body><img data-af-id="image" src="ref:abc123"><svg><circle r="2"></circle></svg><img src="data:image/gif;base64,R0lGODlh"><a href="ref:doc123">Document</a></body></html>';
it('packs only admitted image bytes and preserves original identities and portable SVG/data images',async()=>{
 const loadImage=vi.fn(async()=>({bytes:new Uint8Array([1,2,3]),mime:'image/png'}));
 const packed=await packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage,maxBytes:10000});
 expect(packed).toBe(html.replace('ref:abc123','data:image/png;base64,AQID'));expect(loadImage).toHaveBeenCalledTimes(1);expect(loadImage).toHaveBeenCalledWith('abc123');
});
it('refuses unadmitted and no-longer-readable images without including a URL or credential',async()=>{
 const loadImage=vi.fn(async()=>null);
 await expect(packOfflineHtmlImages({html,admittedIds:[],loadImage,maxBytes:10000})).rejects.toMatchObject({reason:'unavailable'});expect(loadImage).not.toHaveBeenCalled();
 await expect(packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage,maxBytes:10000})).rejects.toBeInstanceOf(OfflineHtmlMediaError);
});
it('enforces the byte budget and raster MIME boundary before producing portable HTML',async()=>{
 await expect(packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage:async()=>({bytes:new Uint8Array(1000),mime:'image/png'}),maxBytes:1000})).rejects.toMatchObject({reason:'too_large'});
 await expect(packOfflineHtmlImages({html,admittedIds:['abc123'],loadImage:async()=>({bytes:new Uint8Array([1]),mime:'text/html'}),maxBytes:10000})).rejects.toMatchObject({reason:'unsupported_type'});
});
