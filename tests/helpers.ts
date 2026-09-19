import QRCode from 'qrcode';
import sharp from 'sharp';
import { writeBarcode } from 'zxing-wasm/writer';
import type { Frame } from '../src/lib/decode';

export async function qrPng(
  text: string,
  size: number,
  options: { invert?: boolean; rotate?: number; errorCorrection?: 'L' | 'M' | 'Q' | 'H' } = {},
): Promise<Buffer> {
  const png = await QRCode.toBuffer(text, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: options.errorCorrection ?? 'M',
  });

  let image = sharp(png);
  if (options.invert) image = image.negate({ alpha: false });
  if (options.rotate) image = image.rotate(options.rotate, { background: '#ffffff' });

  return options.invert || options.rotate ? image.png().toBuffer() : png;
}

export interface Placement {
  png: Buffer;
  left: number;
  top: number;
}

/** Builds a white "screenshot" of the given size with QR images composited into it. */
export async function frameWith(width: number, height: number, placements: Placement[]): Promise<Frame> {
  const canvas = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite(placements.map((placement) => ({ input: placement.png, left: placement.left, top: placement.top })));

  return toFrame(await canvas.png().toBuffer());
}

export async function toFrame(png: Buffer): Promise<Frame> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

/** Re-encodes through JPEG, the way a screenshot or a shared photo arrives. */
export async function jpegArtifacts(png: Buffer, quality: number): Promise<Buffer> {
  return sharp(await sharp(png).jpeg({ quality }).toBuffer()).png().toBuffer();
}

export async function blur(png: Buffer, sigma: number): Promise<Buffer> {
  return sharp(png).blur(sigma).png().toBuffer();
}

/** Squeezes black and white towards mid grey, like a washed-out photo of a screen. */
export async function lowContrast(png: Buffer, keep: number): Promise<Buffer> {
  const offset = (255 * (1 - keep)) / 2;
  return sharp(png).linear(keep, offset).png().toBuffer();
}

/**
 * Lays noise over the code. `strength` is how much of the result is noise, 0 to 1.
 *
 * The noise is generated from a fixed seed rather than by sharp, whose generator cannot be
 * seeded. A test that sits near a threshold has to give the same answer every run, or it
 * reports the weather instead of the decoder.
 */
export async function addNoise(png: Buffer, strength: number, seed = 20260919): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const pixels = Buffer.alloc(width! * height! * 4);

  let state = seed >>> 0;
  for (let index = 0; index < width! * height!; index++) {
    // Lehmer generator: small, deterministic, good enough for scattering grey values.
    state = (state * 48271) % 0x7fffffff;
    const value = state % 256;
    pixels.writeUInt8(value, index * 4);
    pixels.writeUInt8(value, index * 4 + 1);
    pixels.writeUInt8(value, index * 4 + 2);
    pixels.writeUInt8(Math.round(strength * 255), index * 4 + 3);
  }

  const noise = await sharp(pixels, { raw: { width: width!, height: height!, channels: 4 } }).png().toBuffer();
  return sharp(png).composite([{ input: noise, blend: 'over' }]).png().toBuffer();
}

/** Skews the code, as if the screen were viewed from an angle. */
export async function skew(png: Buffer, amount: number): Promise<Buffer> {
  return sharp(png).affine([[1, amount], [amount / 2, 1]], { background: '#ffffff' }).png().toBuffer();
}

/** Covers a corner, like a finger or a sticker over part of the code. */
export async function occlude(png: Buffer, fraction: number): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const w = Math.round(width! * fraction);
  const h = Math.round(height! * fraction);
  const patch = await sharp({ create: { width: w, height: h, channels: 3, background: '#d94f3d' } }).png().toBuffer();
  return sharp(png).composite([{ input: patch, left: width! - w, top: height! - h }]).png().toBuffer();
}

/** A brand mark punched through the middle, which error correction is supposed to absorb. */
export async function centreLogo(png: Buffer, fraction: number): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const size = Math.round(width! * fraction);
  const patch = await sharp({ create: { width: size, height: size, channels: 3, background: '#1b4dd6' } }).png().toBuffer();
  return sharp(png)
    .composite([{ input: patch, left: Math.round((width! - size) / 2), top: Math.round((height! - size) / 2) }])
    .png()
    .toBuffer();
}

/** Loses detail the way a scaled-down page or a low-resolution screenshot does. */
export async function resample(png: Buffer, factor: number): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const small = await sharp(png).resize(Math.round(width! * factor), Math.round(height! * factor)).png().toBuffer();
  return sharp(small).resize(width!, height!).png().toBuffer();
}

/** Cuts part of the code away, as happens at the edge of the viewport. */
export async function clip(png: Buffer, fraction: number): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  return sharp(png)
    .extract({ left: 0, top: 0, width: Math.round(width! * (1 - fraction)), height: height! })
    .png()
    .toBuffer();
}

/** Places the code over busy photographic content rather than flat white. */
export async function overBusyBackground(png: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const pad = 40;
  const background = await sharp({
    create: {
      width: width! + pad * 2,
      height: height! + pad * 2,
      channels: 3,
      background: '#3c6e71',
      noise: { type: 'gaussian', mean: 120, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
  return sharp(background).composite([{ input: png, left: pad, top: pad }]).png().toBuffer();
}

/** Builds the compact QR variants, which the `qrcode` package cannot generate. */
export async function compactQrPng(text: string, format: 'MicroQRCode' | 'rMQRCode', width = 300): Promise<Buffer> {
  const written = await writeBarcode(text, { format, scale: 8 });
  if (!written.image) throw new Error(`could not write a ${format}: ${written.error}`);
  const png = Buffer.from(await written.image.arrayBuffer());

  // Nearest-neighbour keeps the module edges hard, and the quiet zone has to survive the resize.
  return sharp(png)
    .resize({ width, kernel: 'nearest' })
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' })
    .png()
    .toBuffer();
}
