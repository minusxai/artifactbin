/**
 * FIT AN EXPORT UNDER A BYTE BUDGET, keeping its format: a relay that carries an image inside a bounded JSON answer
 * (contracts ARTIFACT_IMAGE_BYTES) needs the picture smaller, never a different kind of file. A PNG is quantized to a
 * palette first (screenshots of pages are a few flat colours), then drawn narrower; a JPEG steps its quality down, then
 * is drawn narrower. Never narrower than `minWidth` (nor wider than it was); still over, the answer says so with what
 * the smallest attempt weighed. Server-only (sharp). Dimensions are the encoder's own output, never the input's.
 */
import sharp from 'sharp';
import {ARTIFACT_IMAGE_BYTES} from '@artifactbin/contracts';

type FitFormat = 'png' | 'jpg';
type FittedImage =
  | {ok: true; bytes: Buffer; width: number; height: number}
  /** Over the budget even at the narrowest width: what that attempt weighed and measured. */
  | {ok: false; bytes: number; width: number; height: number};

/** Pixels the first attempt starts from: a capture past this could never fit, and quantizing it would spend the deadline. */
const START_PIXELS = 4_000_000;
const PNG_STEPS = [{colours: 256}, {colours: 64}] as const;
const JPEG_STEPS = [80, 65, 50] as const;
const NARROW_QUALITY = {png: 64, jpg: 50} as const;
/** Downscale attempts after the in-place steps, each aimed at the budget from the last attempt's weight. */
const NARROW_ATTEMPTS = 5;

async function encode(input: Buffer, format: FitFormat, width: number, original: number, level: number) {
  let image = sharp(input, {limitInputPixels: false});
  if (width < original) image = image.resize({width, withoutEnlargement: true});
  const out = format === 'png'
    ? image.png({palette: true, colours: level, effort: 3, compressionLevel: 9})
    : image.flatten({background: '#ffffff'}).jpeg({quality: level, mozjpeg: true});
  const {data, info} = await out.toBuffer({resolveWithObject: true});
  return {bytes: data, width: info.width, height: info.height};
}

/** `input` (any format sharp reads) as `format`, at most `maxBytes`, at least `minWidth` px wide when it was. */
export async function fitImage(input: Buffer, format: FitFormat, {maxBytes = ARTIFACT_IMAGE_BYTES, minWidth = 320}: {maxBytes?: number; minWidth?: number} = {}): Promise<FittedImage> {
  const meta = await sharp(input, {limitInputPixels: false}).metadata();
  if (!meta.width || !meta.height) throw new Error('Image dimensions missing');
  const same = meta.format === (format === 'png' ? 'png' : 'jpeg');
  if (same && input.length <= maxBytes) return {ok: true, bytes: input, width: meta.width, height: meta.height};
  const floor = Math.min(minWidth, meta.width);
  let width = Math.max(floor, Math.min(meta.width, Math.floor(meta.width * Math.sqrt(START_PIXELS / (meta.width * meta.height)))));
  let last = {bytes: input, width: meta.width, height: meta.height};
  for (const level of format === 'png' ? PNG_STEPS.map(step => step.colours) : JPEG_STEPS) {
    last = await encode(input, format, width, meta.width, level);
    if (last.bytes.length <= maxBytes) return {ok: true, ...last};
  }
  for (let attempt = 0; attempt < NARROW_ATTEMPTS && width > floor; attempt++) {
    // Bytes follow area: aim a little under the budget, and always narrow by at least a seventh.
    width = Math.max(floor, Math.min(Math.floor(width * 0.85), Math.floor(width * Math.sqrt(maxBytes / last.bytes.length) * 0.92)));
    last = await encode(input, format, width, meta.width, NARROW_QUALITY[format]);
    if (last.bytes.length <= maxBytes) return {ok: true, ...last};
  }
  return {ok: false, bytes: last.bytes.length, width: last.width, height: last.height};
}
