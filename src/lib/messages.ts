import type { Box } from './decode';

export interface ElementRect {
  /** CSS pixels, relative to the viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface ScanHit {
  text: string;
  /** Where the code sits in the screenshot, in device pixels. Absent when the code did not come
   *  from a screenshot of the viewport, so there is nothing to point at on the page. */
  box?: Box;
}

/** Background -> content script. */
export type ToContent =
  | { type: 'QRP_SHOW'; hits: ScanHit[]; error?: string }
  | { type: 'QRP_READ_IMAGE'; srcUrl: string };

/** Answer to an open request. */
export interface OpenResponse {
  ok: boolean;
  error?: string;
}

/** Answer to a scan request, from the background to the popup. */
export interface ScanResponse {
  hits: ScanHit[];
  error?: string;
}

/** Answer to QRP_READ_IMAGE. Decoding happens in the background, so the page only supplies pixels. */
export interface ImageReadResponse {
  /** The image re-encoded by the page. Absent when the canvas was tainted by another origin. */
  imageDataUrl?: string;
  /** Where the image sits on screen, so the background can crop a screenshot instead. */
  rect?: ElementRect | null;
  error?: string;
}

/** Content script / popup -> background. */
export type ToBackground =
  | { type: 'QRP_OPEN_URL'; url: string }
  /** The popup asks the background to run the same scan the keyboard shortcut runs. */
  | { type: 'QRP_SCAN_ACTIVE_TAB' };

export const CONTENT_SCRIPT_FILE = 'content/overlay.js';
/** Packaged next to the manifest; the decoder resolves it through runtime.getURL. */
export const WASM_FILE = 'zxing_reader.wasm';
