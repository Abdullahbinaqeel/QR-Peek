import api, { isRestrictedUrl, RESTRICTED_PAGE_MESSAGE } from '../lib/browser';
import { canDecodeHere, captureVisibleTabDataUrl, frameFromDataUrl } from '../lib/capture';
import { configureDecoder, cropFrame, scaleFrame, scanFrame, type Frame } from '../lib/decode';
import {
  CONTENT_SCRIPT_FILE,
  WASM_FILE,
  type ElementRect,
  type ImageReadResponse,
  type ScanHit,
  type ScanResponse,
  type ToBackground,
  type ToContent,
} from '../lib/messages';
import { classify } from '../lib/payload';

/** Replaced at build time. False in a shipped build, which removes the block that reads it. */
declare const __QRP_TEST__: boolean;

const CONTEXT_MENU_ID = 'qrp-scan-image';
const LAST_ERROR_KEY = 'qrpeek:lastError';

// The decoder's WebAssembly binary ships with the extension; nothing is fetched from the network.
configureDecoder({ locateFile: (path: string) => (path.endsWith('.wasm') ? api.runtime.getURL(WASM_FILE) : path) });

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Scan QR code in this image',
      contexts: ['image'],
    });
  });
});

api.commands.onCommand.addListener((command, tab) => {
  if (command !== 'scan-visible-tab') return;
  void withTab(tab, (resolved) => scanVisibleTab(resolved));
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl) return;
  const srcUrl = info.srcUrl;
  void withTab(tab, (resolved) => scanImage(resolved, srcUrl));
});

const STALE_WORKER_MESSAGE =
  'This extension was rebuilt while it was loaded, so its pages and its background no longer match. Open the extensions page and press reload on QR Peek.';

api.runtime.onMessage.addListener((message: ToBackground, _sender, sendResponse) => {
  if (message?.type === 'QRP_OPEN_URL') {
    openUrl(message.url)
      .then((opened) =>
        sendResponse(
          opened
            ? { ok: true }
            : { ok: false, error: 'That payload is not a plain web link, so it was not opened.' },
        ),
      )
      .catch((error: unknown) => sendResponse({ ok: false, error: describe(error) }));
    return true; // async reply
  }

  if (message?.type === 'QRP_SCAN_ACTIVE_TAB') {
    scanActiveTab()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ hits: [], error: describe(error) } satisfies ScanResponse));
    return true; // async reply
  }

  // An unrecognised type means the caller and this worker came from different builds, which
  // happens when the unpacked folder is rebuilt without reloading the extension. Answer anyway:
  // a silent non-reply looks to the caller exactly like a background that never woke up.
  sendResponse({ hits: [], error: STALE_WORKER_MESSAGE } satisfies ScanResponse);
  return false;
});

/** Popup entry point: the same capture and decode as the shortcut, but the popup draws it. */
async function scanActiveTab(): Promise<ScanResponse> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { hits: [], error: 'No active tab to scan.' };
  if (isRestrictedUrl(tab.url)) return { hits: [], error: RESTRICTED_PAGE_MESSAGE };

  await clearBadge(tab.id);
  return { hits: await captureAndDecode(tab) };
}

async function withTab(tab: chrome.tabs.Tab | undefined, run: (tab: chrome.tabs.Tab) => Promise<void>): Promise<void> {
  const resolved = tab?.id !== undefined ? tab : (await api.tabs.query({ active: true, currentWindow: true }))[0];
  if (!resolved?.id) return;

  try {
    await run(resolved);
  } catch (error) {
    await reportFailure(resolved, describe(error));
  }
}

async function scanVisibleTab(tab: chrome.tabs.Tab): Promise<void> {
  if (isRestrictedUrl(tab.url)) {
    await reportFailure(tab, RESTRICTED_PAGE_MESSAGE);
    return;
  }

  await clearBadge(tab.id);
  await showResults(tab.id!, await captureAndDecode(tab));
}

async function captureAndDecode(tab: chrome.tabs.Tab): Promise<ScanHit[]> {
  assertCanDecode();
  const frame = await frameFromDataUrl(await captureVisibleTabDataUrl(tab.windowId));
  return (await scanFrame(frame)).map((result) => ({ text: result.text, box: result.box }));
}

/**
 * Right-click path. The page gets first refusal because the image's own pixels beat a
 * screenshot of them; a cross-origin image taints the canvas, and then the screenshot is
 * cropped down to where that image sits on screen.
 */
async function scanImage(tab: chrome.tabs.Tab, srcUrl: string): Promise<void> {
  if (isRestrictedUrl(tab.url)) {
    await reportFailure(tab, RESTRICTED_PAGE_MESSAGE);
    return;
  }

  assertCanDecode();
  await clearBadge(tab.id);
  const tabId = tab.id!;
  const fromPage = await sendToContent<ImageReadResponse>(tabId, { type: 'QRP_READ_IMAGE', srcUrl });

  if (fromPage.imageDataUrl) {
    const frame = await frameFromDataUrl(fromPage.imageDataUrl);
    const hits = await scanFrame(upscaleIfTiny(frame));
    if (hits.length > 0) {
      // These coordinates sit inside the image, not the viewport, so they point at nothing.
      await showResults(tabId, hits.map((hit) => ({ text: hit.text })));
      return;
    }
  }

  const frame = await frameFromDataUrl(await captureVisibleTabDataUrl(tab.windowId));
  const cropped = fromPage.rect ? cropToRect(frame, fromPage.rect) : frame;
  await showResults(tabId, (await scanFrame(cropped)).map((result) => ({ text: result.text })));
}

function cropToRect(frame: Frame, rect: ElementRect): Frame {
  // The screenshot is in device pixels; getBoundingClientRect is in CSS pixels.
  const ratio = rect.devicePixelRatio || 1;
  const pad = 8 * ratio; // a code needs its quiet zone to decode
  const cropped = cropFrame(
    frame,
    rect.x * ratio - pad,
    rect.y * ratio - pad,
    rect.width * ratio + pad * 2,
    rect.height * ratio + pad * 2,
  );
  return upscaleIfTiny(cropped);
}

/** A favicon-sized code decodes more reliably with a few more samples per module. */
function upscaleIfTiny(frame: Frame): Frame {
  if (frame.width >= 320) return frame;
  const factor = Math.min(4, Math.ceil(320 / Math.max(1, frame.width)));
  return scaleFrame(frame, frame.width * factor, frame.height * factor);
}

function assertCanDecode(): void {
  if (canDecodeHere()) return;
  throw new Error('This browser version cannot turn a screenshot into pixels for scanning. Safari 16.4 or newer is required.');
}

async function showResults(tabId: number, hits: ScanHit[]): Promise<void> {
  await sendToContent(tabId, { type: 'QRP_SHOW', hits });
}

async function sendToContent<T>(tabId: number, message: ToContent): Promise<T> {
  await api.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  return (await api.tabs.sendMessage(tabId, message)) as T;
}

/** Returns false when the payload is one this extension will not navigate to. */
async function openUrl(url: string): Promise<boolean> {
  // Re-classify here rather than trusting the sender: a compromised page can post this message.
  const payload = classify(url);
  if (!payload.openUrl) return false;

  await api.tabs.create({ url: payload.openUrl });
  return true;
}

async function reportFailure(tab: chrome.tabs.Tab, message: string): Promise<void> {
  if (tab.id !== undefined && !isRestrictedUrl(tab.url)) {
    try {
      await sendToContent(tab.id, { type: 'QRP_SHOW', hits: [], error: message });
      return;
    } catch {
      // The page refuses injection (CSP-restricted, still loading, or browser-internal).
    }
  }

  await setBadge(tab.id, message);
}

async function setBadge(tabId: number | undefined, message: string): Promise<void> {
  try {
    await api.action.setBadgeText(tabId === undefined ? { text: '!' } : { text: '!', tabId });
    await api.action.setBadgeBackgroundColor({ color: '#a32218' });
    await api.action.setTitle({ title: `QR Peek: ${message}`, ...(tabId === undefined ? {} : { tabId }) });
    await session().set({ [LAST_ERROR_KEY]: message });
  } catch (error) {
    console.warn('[QR Peek] could not surface error:', describe(error));
  }
}

async function clearBadge(tabId: number | undefined): Promise<void> {
  try {
    await api.action.setBadgeText(tabId === undefined ? { text: '' } : { text: '', tabId });
    await session().remove(LAST_ERROR_KEY);
  } catch {
    // Badge state is cosmetic; never let it break a scan.
  }
}

/** storage.session is unavailable on older Safari; local is an acceptable stand-in here. */
function session(): chrome.storage.StorageArea {
  return api.storage.session ?? api.storage.local;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Neither chrome.commands nor chrome.contextMenus can be fired programmatically, so the browser
// suite reaches the handlers behind them through here. esbuild removes this entirely when
// __QRP_TEST__ is false, and the build script verifies the shipped bundle does not mention it.
if (__QRP_TEST__) {
  (globalThis as unknown as Record<string, unknown>)['__qrpTestHooks'] = {
    /** Exactly what the keyboard shortcut runs. */
    scanVisibleTab: async (tabId: number) => {
      const tab = await api.tabs.get(tabId);
      await withTab(tab, (resolved) => scanVisibleTab(resolved));
    },
    /** Exactly what the context menu runs. */
    scanImage: async (tabId: number, srcUrl: string) => {
      const tab = await api.tabs.get(tabId);
      await withTab(tab, (resolved) => scanImage(resolved, srcUrl));
    },
  };
}
