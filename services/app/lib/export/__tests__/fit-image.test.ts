/** The byte-budget fit: a large PNG and JPEG come back under the budget in the same format, measured as encoded. */
import sharp from 'sharp';
import {describe,expect,it} from 'vitest';
import {ARTIFACT_IMAGE_BYTES} from '@artifactbin/contracts';
import {fitImage} from '..';

/** A page-like picture: flat bands, gradients and one noisy channel, so neither encoder can shrink it for free. */
async function picture(width:number,height:number,format:'png'|'jpg'):Promise<Buffer>{
 const raw=Buffer.alloc(width*height*3);let seed=7;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3;seed=(seed*1103515245+12345)&0x7fffffff;
  raw[i]=(Math.floor(y/40)%6*40+x/8)&255;raw[i+1]=(x*y/97)&255;raw[i+2]=seed>>>16&255;
 }
 const image=sharp(raw,{raw:{width,height,channels:3}});
 return format==='png'?image.png().toBuffer():image.jpeg({quality:92}).toBuffer();
}
const measured=async(bytes:Buffer)=>{const meta=await sharp(bytes).metadata();return {format:meta.format,width:meta.width,height:meta.height};};

describe('fitImage',()=>{
 it('fits a large PNG under the budget as a PNG, reporting the dimensions it encoded',async()=>{
  const input=await picture(1200,1600,'png');
  expect(input.length).toBeGreaterThan(ARTIFACT_IMAGE_BYTES*5);
  const fitted=await fitImage(input,'png');
  if(!fitted.ok)throw new Error(`not fitted: ${JSON.stringify(fitted)}`);
  expect(fitted.bytes.length).toBeLessThanOrEqual(ARTIFACT_IMAGE_BYTES);
  expect(await measured(fitted.bytes)).toEqual({format:'png',width:fitted.width,height:fitted.height});
  expect(fitted.width).toBeGreaterThanOrEqual(320);
  // The aspect ratio holds: only the width was chosen.
  expect(Math.abs(fitted.height/fitted.width-1600/1200)).toBeLessThan(0.01);
 });

 it('fits a large JPEG under the budget as a JPEG',async()=>{
  const input=await picture(2400,1600,'jpg');
  expect(input.length).toBeGreaterThan(ARTIFACT_IMAGE_BYTES*3);
  const fitted=await fitImage(input,'jpg');
  if(!fitted.ok)throw new Error(`not fitted: ${JSON.stringify(fitted)}`);
  expect(fitted.bytes.length).toBeLessThanOrEqual(ARTIFACT_IMAGE_BYTES);
  expect(await measured(fitted.bytes)).toEqual({format:'jpeg',width:fitted.width,height:fitted.height});
  expect(fitted.width).toBeGreaterThanOrEqual(320);
 });

 it('passes a small image of the asked format through untouched, and converts one of another format',async()=>{
  const small=await sharp({create:{width:500,height:300,channels:3,background:'#ffffff'}}).png().toBuffer();
  expect(await fitImage(small,'png')).toEqual({ok:true,bytes:small,width:500,height:300});
  const converted=await fitImage(small,'jpg');
  if(!converted.ok)throw new Error('not fitted');
  expect(await measured(converted.bytes)).toEqual({format:'jpeg',width:500,height:300});
 });

 it('never draws narrower than 320 px, and says what the narrowest attempt weighed when it is still over',async()=>{
  const tall=await picture(400,4000,'png');
  const refused=await fitImage(tall,'png',{maxBytes:20_000});
  expect(refused).toMatchObject({ok:false,width:320,height:3200});
  if(refused.ok)throw new Error('fitted');
  expect(refused.bytes).toBeGreaterThan(20_000);
  // A picture already narrower than the floor is never enlarged.
  const narrow=await fitImage(await picture(200,3000,'jpg'),'jpg',{maxBytes:5_000});
  expect(narrow).toMatchObject({ok:false,width:200});
 });
});
