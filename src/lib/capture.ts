import type { Frame } from './decode';
import api from './browser';

/** True when this context can rasterise an image without a DOM (i.e. inside a service worker). */
export function canDecodeHere(): boolean {
  const hasCanvas =
    typeof OffscreenCanvas !== 'undefined' || (typeof document !== 'undefined' && !!document.createElement);
  return typeof createImageBitmap === 'function' && hasCanvas;
}

export async function captureVisibleTabDataUrl(windowId?: number): Promise<string> {
  const dataUrl = await api.tabs.captureVisibleTab(windowId as number, { format: 'png' });
  if (!dataUrl) throw new Error('The browser returned an empty screenshot.');
  return dataUrl;
}

export async function frameFromDataUrl(dataUrl: string): Promise<Frame> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return frameFromBlob(blob);
}

export async function frameFromBlob(blob: Blob): Promise<Frame> {
  const bitmap = await createImageBitmap(blob);
  try {
    return frameFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

function frameFromBitmap(bitmap: ImageBitmap): Frame {
  const { width, height } = bitmap;
  if (width === 0 || height === 0) throw new Error('The captured image was empty.');

  const context = createContext(width, height);
  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

type Rasteriser = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createContext(width: number, height: number): Rasteriser {
  // willReadFrequently keeps the surface on the CPU, which is where we read it back from.
  const options: CanvasRenderingContext2DSettings = { willReadFrequently: true, alpha: false };

  if (typeof OffscreenCanvas !== 'undefined') {
    const context = new OffscreenCanvas(width, height).getContext('2d', options);
    if (context) return context;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', options);
    if (context) return context;
  }
  throw new Error('This browser context cannot rasterise images for scanning.');
}

/**
 * Fetches an image the user right-clicked. Decoding the source image beats decoding a
 * screenshot of it: no scaling, no compositing, no overlapping page content.
 */
export async function frameFromImageUrl(srcUrl: string): Promise<Frame> {
  const response = await fetch(srcUrl, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Could not load that image (HTTP ${response.status}).`);
  return frameFromBlob(await response.blob());
}
