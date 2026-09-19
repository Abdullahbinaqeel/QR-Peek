import { describe, expect, it } from 'vitest';
import { scanFrame } from '../src/lib/decode';
import {
  addNoise,
  blur,
  centreLogo,
  clip,
  frameWith,
  jpegArtifacts,
  lowContrast,
  occlude,
  overBusyBackground,
  qrPng,
  resample,
  skew,
  throughCapture,
  toFrame,
} from './helpers';

const LINK = 'https://example.com/robustness';

/** A code meant for the real world, at the error correction level such codes use. */
const realWorldCode = () => qrPng(LINK, 420, { errorCorrection: 'H' });

const read = async (png: Buffer) => (await scanFrame(await toFrame(png))).map((hit) => hit.text);

/**
 * Codes in the wild are not the clean renders the other decode tests use: they are compressed,
 * blurred, glared out, partly covered, or shrunk by a zoomed-out page.
 *
 * The thresholds below were measured by sweeping each kind of damage until the decoder gave up.
 * Each pair pins the boundary from both sides, so weakening the decoder fails the first case and
 * quietly loosening it fails the second. The README quotes these numbers.
 */
describe('damage a code survives', () => {
  it.each([
    ['blur, sigma 6', (png: Buffer) => blur(png, 6)],
    ['a corner covered, 45% of the width', (png: Buffer) => occlude(png, 0.45)],
    ['a logo over 35% of the middle', (png: Buffer) => centreLogo(png, 0.35)],
    ['a tenth of the original contrast', (png: Buffer) => lowContrast(png, 0.1)],
    ['scaled to 10% and back up', (png: Buffer) => resample(png, 0.1)],
    ['skewed by 0.3, as if seen from an angle', (png: Buffer) => skew(png, 0.3)],
    ['JPEG quality 5', (png: Buffer) => jpegArtifacts(png, 5)],
    ['noise over a quarter of the image', (png: Buffer) => addNoise(png, 0.25)],
    ['a piece clipped off, 5% of the width', (png: Buffer) => clip(png, 0.05)],
    ['a busy photographic background', overBusyBackground],
  ])('reads a code through %s', async (_name, degrade) => {
    expect(await read(await degrade(await realWorldCode()))).toEqual([LINK]);
  });

  it('reads a blurred code inside a full screenshot, not just on its own', async () => {
    const png = await blur(await qrPng(LINK, 260, { errorCorrection: 'H' }), 1.2);
    const frame = await frameWith(2560, 1440, [{ png, left: 1800, top: 900 }]);
    expect((await scanFrame(frame)).map((hit) => hit.text)).toEqual([LINK]);
  });

  it('reads a code only 50px across in a 2560x1440 screenshot', async () => {
    const frame = await frameWith(2560, 1440, [{ png: await qrPng(LINK, 50), left: 1200, top: 700 }]);
    expect((await scanFrame(frame)).map((hit) => hit.text)).toEqual([LINK]);
  });
});

describe('damage past the limit, where it must report nothing rather than guess', () => {
  it.each([
    ['blur, sigma 8', (png: Buffer) => blur(png, 8)],
    ['half the code covered', (png: Buffer) => occlude(png, 0.5)],
    ['a logo over 40% of the middle', (png: Buffer) => centreLogo(png, 0.4)],
    ['contrast down to 6%', (png: Buffer) => lowContrast(png, 0.06)],
    ['scaled to 8% and back up', (png: Buffer) => resample(png, 0.08)],
    ['skewed by 0.4', (png: Buffer) => skew(png, 0.4)],
    ['noise over 30% of the image', (png: Buffer) => addNoise(png, 0.3)],
    ['a tenth of the code cut away', (png: Buffer) => clip(png, 0.1)],
  ])('gives up on %s', async (_name, degrade) => {
    expect(await read(await degrade(await realWorldCode()))).toEqual([]);
  });

  it('gives up on a code 40px across in a 2560x1440 screenshot', async () => {
    const frame = await frameWith(2560, 1440, [{ png: await qrPng(LINK, 40), left: 1200, top: 700 }]);
    expect(await scanFrame(frame)).toEqual([]);
  });

  it('never invents a payload from noise alone', async () => {
    const noise = await addNoise(await qrPng('placeholder', 400), 0.95);
    for (const hit of await scanFrame(await toFrame(noise))) expect(hit.text).toBe('placeholder');
  });
});

describe('through the capture pipeline the extension actually uses', () => {
  // Screenshots are taken as JPEG, because encoding a full-screen PNG is the slowest step in a
  // scan by some margin. These cases prove the compression costs nothing in decoding terms.
  it('still reads the smallest code that a raw frame can manage', async () => {
    const frame = await frameWith(2560, 1440, [{ png: await qrPng(LINK, 50), left: 1200, top: 700 }]);
    expect((await scanFrame(await throughCapture(frame))).map((hit) => hit.text)).toEqual([LINK]);
  });

  it.each([
    ['blur, sigma 6', (png: Buffer) => blur(png, 6)],
    ['a corner covered, 45% of the width', (png: Buffer) => occlude(png, 0.45)],
    ['a tenth of the original contrast', (png: Buffer) => lowContrast(png, 0.1)],
    ['noise over a quarter of the image', (png: Buffer) => addNoise(png, 0.25)],
  ])('holds the limit for %s', async (_name, degrade) => {
    const degraded = await toFrame(await degrade(await realWorldCode()));
    expect((await scanFrame(await throughCapture(degraded))).map((hit) => hit.text)).toEqual([LINK]);
  });
});

describe('load and concurrency', () => {
  it('decodes a 4K screenshot within a sensible time', async () => {
    const frame = await frameWith(3840, 2160, [{ png: await qrPng(LINK, 300), left: 3000, top: 1600 }]);
    const start = performance.now();
    const hits = await scanFrame(frame);
    const elapsed = performance.now() - start;

    expect(hits.map((hit) => hit.text)).toEqual([LINK]);
    expect(elapsed).toBeLessThan(3000);
  });

  it('handles overlapping scans without mixing their results', async () => {
    const frames = await Promise.all(
      ['one', 'two', 'three', 'four'].map(async (word) => toFrame(await qrPng(`https://example.com/${word}`, 300))),
    );
    const results = await Promise.all(frames.map((frame) => scanFrame(frame)));
    expect(results.map((hits) => hits[0]?.text)).toEqual([
      'https://example.com/one',
      'https://example.com/two',
      'https://example.com/three',
      'https://example.com/four',
    ]);
  });

  it('survives a frame with no pixels rather than throwing', async () => {
    await expect(scanFrame({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).resolves.toEqual([]);
  });
});
