import { prepareZXingModule, readBarcodes, type ReadResult, type ZXingModuleOverrides } from 'zxing-wasm/reader';

/** A raw RGBA image buffer, shaped like ImageData so it can cross contexts unchanged. */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrResult {
  text: string;
  /** Where the code sits in the frame that was scanned. */
  box: Box;
}

/**
 * Points the decoder at its WebAssembly binary. The extension resolves it to a packaged file;
 * tests hand over the bytes directly. Must be called before the first scan.
 */
export function configureDecoder(overrides: ZXingModuleOverrides): void {
  prepareZXingModule({ overrides, fireImmediately: false });
}

export interface ScanOptions {
  /** Upper bound on codes reported from one frame. */
  maxResults?: number;
}

/**
 * Reads every QR code in a frame.
 *
 * ZXing detects multiple symbols in a single pass, including rotated, inverted and small
 * codes, so there is no tiling or rescanning to do here. An earlier version of this file used
 * jsQR, which reports one code per call and whose finder-pattern grouping fails outright once
 * several codes share a frame.
 */
export async function scanFrame(frame: Frame, options: ScanOptions = {}): Promise<QrResult[]> {
  // ZXing reads only data/width/height. The DOM ImageData type additionally requires
  // colorSpace, which a buffer built in a worker does not carry.
  const results = await readBarcodes(frame as unknown as ImageData, {
    formats: ['QRCode', 'MicroQRCode', 'rMQRCode'],
    tryHarder: true,
    tryInvert: true,
    tryRotate: true,
    tryDownscale: true,
    maxNumberOfSymbols: options.maxResults ?? 8,
  });

  const seen = new Set<string>();
  const hits: QrResult[] = [];

  for (const result of results) {
    if (!result.text || seen.has(result.text)) continue;
    seen.add(result.text);
    hits.push({ text: result.text, box: toBox(result) });
  }

  return hits;
}

function toBox(result: ReadResult): Box {
  const corners = [
    result.position.topLeft,
    result.position.topRight,
    result.position.bottomRight,
    result.position.bottomLeft,
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(...xs) - x), height: Math.round(Math.max(...ys) - y) };
}

export function cropFrame(frame: Frame, x: number, y: number, width: number, height: number): Frame {
  const sx = clamp(Math.round(x), 0, frame.width);
  const sy = clamp(Math.round(y), 0, frame.height);
  const w = clamp(Math.round(width), 1, frame.width - sx);
  const h = clamp(Math.round(height), 1, frame.height - sy);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let row = 0; row < h; row++) {
    const srcStart = ((sy + row) * frame.width + sx) * 4;
    out.set(frame.data.subarray(srcStart, srcStart + w * 4), row * w * 4);
  }

  return { data: out, width: w, height: h };
}

/** Bilinear resample, used to give a cropped thumbnail more pixels to work with. */
export function scaleFrame(frame: Frame, targetWidth: number, targetHeight: number): Frame {
  const w = Math.max(1, Math.round(targetWidth));
  const h = Math.max(1, Math.round(targetHeight));
  if (w === frame.width && h === frame.height) return frame;

  const out = new Uint8ClampedArray(w * h * 4);
  const xRatio = frame.width / w;
  const yRatio = frame.height / h;

  for (let y = 0; y < h; y++) {
    const srcY = Math.min(frame.height - 1, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(frame.height - 1, y0 + 1);
    const wy = srcY - y0;

    for (let x = 0; x < w; x++) {
      const srcX = Math.min(frame.width - 1, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(frame.width - 1, x0 + 1);
      const wx = srcX - x0;

      const i00 = (y0 * frame.width + x0) * 4;
      const i01 = (y0 * frame.width + x1) * 4;
      const i10 = (y1 * frame.width + x0) * 4;
      const i11 = (y1 * frame.width + x1) * 4;
      const o = (y * w + x) * 4;

      for (let channel = 0; channel < 4; channel++) {
        const top = frame.data[i00 + channel] * (1 - wx) + frame.data[i01 + channel] * wx;
        const bottom = frame.data[i10 + channel] * (1 - wx) + frame.data[i11 + channel] * wx;
        out[o + channel] = top * (1 - wy) + bottom * wy;
      }
    }
  }

  return { data: out, width: w, height: h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
