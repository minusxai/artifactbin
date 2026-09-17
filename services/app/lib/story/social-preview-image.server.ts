/** Shared cover-image pixels for published and local exports. */
import sharp from 'sharp';
import {CARD_WIDTH,CARD_HEIGHT} from '../export-card';
import {clampImageCrop,savedSocialPreviewImageCrop} from './social-preview';
export async function renderSocialPreviewImage(body:Buffer,source:string,format:'png'|'jpg',imageOverview=false):Promise<Buffer>{
  // Normalize EXIF orientation before measuring/extracting so browser
  // coordinates and exported pixels refer to the same image.
  const oriented = await sharp(body).rotate().toBuffer({ resolveWithObject: true });
  let pipeline = sharp(oriented.data);
  const crop = savedSocialPreviewImageCrop(source);
  if (!imageOverview && crop) {
    const { width, height } = oriented.info;
    const density = width / CARD_WIDTH;
    const bounded = clampImageCrop(crop, height / density);
    const left = Math.min(width - 1, Math.round(bounded.x * density));
    const top = Math.min(height - 1, Math.round(bounded.y * density));
    pipeline = pipeline.extract({ left, top,
      width: Math.max(1, Math.min(width - left, Math.round(bounded.width * density))),
      height: Math.max(1, Math.min(height - top, Math.round(bounded.width * CARD_HEIGHT / CARD_WIDTH * density))),
    });
  }
  if (!imageOverview) pipeline = pipeline.resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' });
  const bytes = await (format === 'jpg' ? pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
  return bytes;
}
