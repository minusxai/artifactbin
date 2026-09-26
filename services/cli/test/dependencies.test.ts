import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetInput} from '../src/upload-input';
import {assetFormatOf} from '../../app/lib/story/file-types';
import {validateMarkupStructure} from '../../app/lib/story/local-validation';
test('artifact source rejects local paths instead of discovering files or rewriting references',()=>{
 for(const source of ['<a href="./appendix.jsx">Appendix</a>','<img src="./photo.png" />','<img srcSet="./photo.png 1x, ./large.png 2x" />','<Helmet><Import name="sales" src="./sales.csv" /><Query name="q">{`select * from sales.rows`}</Query></Helmet><p>Sales</p>'])assert.ok(validateMarkupStructure(source).errors.some(error=>error.message.includes('Local file references')));
 assert.deepEqual(validateMarkupStructure('<a href="/a/abc123">Appendix</a><img src="ref:def456" />').errors,[]);
});
test('standalone files still choose the correct upload format',()=>{
 for(const [filename,format] of [['photo.png','image'],['logo.svg','image'],['scan.pdf','pdf'],['clip.mp4','file'],['art.avif','file']] as const){assert.equal(assetFormatOf(filename),format);assert.equal(Object.keys(assetInput(filename,Buffer.from('bytes')))[0],format);}
});
test('local reference guidance distinguishes data/media IDs from navigation URLs',()=>{
 const image=validateMarkupStructure('<img src="./photo.png" />').errors.find(error=>error.message.includes('Local file references'))!;
 assert.equal(image.message,'Local file references are not supported. Run afbin add --json and use ref:ID for dataset and media references.');
 const link=validateMarkupStructure('<a href="./appendix.jsx">Appendix</a>').errors.find(error=>error.message.includes('Local file references'))!;
 assert.equal(link.message,'Local file references are not supported. Run afbin add --json and use /a/ID for document navigation links.');
});
