import { describe, expect, it } from 'vitest';
import { cropFrame, scaleFrame, scanFrame } from '../src/lib/decode';
import { compactQrPng, frameWith, qrPng, toFrame } from './helpers';

const LINK = 'https://example.com/hello?utm=qr';
const OTHER = 'https://second.example.org/other';

const texts = async (...args: Parameters<typeof scanFrame>) => (await scanFrame(...args)).map((hit) => hit.text);

describe('scanFrame', () => {
  it('reads a clean, well-sized code', async () => {
    expect(await texts(await toFrame(await qrPng(LINK, 320)))).toEqual([LINK]);
  });

  it('finds a small code in the corner of a large screenshot', async () => {
    const frame = await frameWith(1600, 900, [{ png: await qrPng(LINK, 120), left: 1420, top: 720 }]);
    const hits = await scanFrame(frame);
    expect(hits.map((hit) => hit.text)).toEqual([LINK]);
    // The box is reported in the coordinates of the frame that was scanned.
    expect(hits[0]!.box.x).toBeGreaterThan(1400);
    expect(hits[0]!.box.y).toBeGreaterThan(700);
  });

  it('reads an inverted, dark-mode code', async () => {
    expect(await texts(await toFrame(await qrPng(LINK, 320, { invert: true })))).toEqual([LINK]);
  });

  it('reads a rotated code', async () => {
    expect(await texts(await toFrame(await qrPng(LINK, 320, { rotate: 33 })))).toEqual([LINK]);
  });

  it('reports both codes when two sit side by side', async () => {
    const frame = await frameWith(1400, 800, [
      { png: await qrPng(LINK, 220), left: 80, top: 80 },
      { png: await qrPng(OTHER, 220), left: 1000, top: 500 },
    ]);
    expect((await texts(frame)).sort()).toEqual([LINK, OTHER].sort());
  });

  it('returns nothing for a frame with no code', async () => {
    expect(await scanFrame(await frameWith(800, 600, []))).toEqual([]);
  });

  it('survives a high-DPI capture', async () => {
    const frame = await frameWith(2560, 1440, [{ png: await qrPng(LINK, 460), left: 900, top: 400 }]);
    expect(await texts(frame)).toEqual([LINK]);
  });

  it('reads every code in a tight grid, where one view holds several', async () => {
    // Six codes packed together. The previous jsQR-based decoder returned at most two here,
    // because its finder-pattern grouping breaks once several codes share a frame.
    const wanted = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((w) => `https://example.com/${w}`);
    const placements = await Promise.all(
      wanted.map(async (text, index) => ({
        png: await qrPng(text, 300),
        left: 60 + (index % 3) * 340,
        top: 60 + Math.floor(index / 3) * 340,
      })),
    );
    expect((await texts(await frameWith(1400, 900, placements))).sort()).toEqual([...wanted].sort());
  });

  it('honours the result cap', async () => {
    const placements = await Promise.all(
      [0, 1, 2, 3].map(async (index) => ({
        png: await qrPng(`https://example.com/${index}`, 240),
        left: 40 + index * 280,
        top: 40,
      })),
    );
    expect(await texts(await frameWith(1200, 340, placements), { maxResults: 2 })).toHaveLength(2);
  });
});

describe('the compact QR variants the decoder claims to read', () => {
  // Micro QR holds a couple of dozen characters at most, which is why table numbers and stock
  // codes use it rather than links.
  it.each([
    ['MicroQRCode', 'TABLE 12'],
    ['rMQRCode', 'https://example.com/compact'],
  ] as const)('reads a %s', async (format, payload) => {
    expect(await texts(await toFrame(await compactQrPng(payload, format)))).toEqual([payload]);
  });

  it('finds a Micro QR inside a screenshot', async () => {
    const frame = await frameWith(1600, 900, [
      { png: await compactQrPng('AISLE 7', 'MicroQRCode', 220), left: 1200, top: 560 },
    ]);
    expect(await texts(frame)).toEqual(['AISLE 7']);
  });
});

describe('frame geometry', () => {
  it('crops within bounds even when asked for more than exists', async () => {
    const cropped = cropFrame(await frameWith(200, 100, []), -20, 50, 400, 400);
    expect(cropped).toMatchObject({ width: 200, height: 50 });
    expect(cropped.data.length).toBe(200 * 50 * 4);
  });

  it('scales a code up without destroying it', async () => {
    const frame = await toFrame(await qrPng(LINK, 120));
    const scaled = scaleFrame(frame, frame.width * 2, frame.height * 2);
    expect(scaled.width).toBe(frame.width * 2);
    expect(await texts(scaled)).toEqual([LINK]);
  });

  it('crops a single code out of a busy frame', async () => {
    const frame = await frameWith(1200, 600, [
      { png: await qrPng(LINK, 200), left: 60, top: 60 },
      { png: await qrPng(OTHER, 200), left: 800, top: 300 },
    ]);
    expect(await texts(cropFrame(frame, 740, 240, 330, 330))).toEqual([OTHER]);
  });
});
