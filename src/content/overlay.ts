import api, { askBackground } from '../lib/browser';
import { icon } from '../lib/icons';
import type { ElementRect, ImageReadResponse, OpenResponse, ScanHit, ToBackground, ToContent } from '../lib/messages';
import { classify } from '../lib/payload';
import { CARD_STYLES, copyText, renderResultCard } from '../lib/resultCard';

/** Replaced at build time. False in a shipped build, which removes the block that reads it. */
declare const __QRP_TEST__: boolean;

const HOST_ID = 'qr-peek-overlay';
const INJECTED_FLAG = '__qrPeekInjected';

interface InjectedWindow extends Window {
  [INJECTED_FLAG]?: boolean;
}

const pageWindow = window as InjectedWindow;

// executeScript re-runs this file on every scan, so everything below must be idempotent.
if (!pageWindow[INJECTED_FLAG]) {
  pageWindow[INJECTED_FLAG] = true;
  api.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: describe(error) } satisfies ImageReadResponse));
    return true; // keep the channel open for the async reply
  });
}

async function handleMessage(message: ToContent): Promise<ImageReadResponse | { ok: true }> {
  switch (message.type) {
    case 'QRP_SHOW':
      showOverlay(message.hits, message.error);
      return { ok: true };
    case 'QRP_READ_IMAGE':
      return readImage(message.srcUrl);
  }
}

/**
 * Re-encodes the image the user right-clicked, which is far better input than a screenshot of
 * it. A cross-origin image without CORS headers taints the canvas and throws on export; then
 * only the element's on-screen rect goes back, and the background crops the screenshot.
 */
async function readImage(srcUrl: string): Promise<ImageReadResponse> {
  const element = findImage(srcUrl);
  const rect = element ? toElementRect(element) : null;

  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = srcUrl;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2d context available.');
    context.drawImage(image, 0, 0);

    return { imageDataUrl: canvas.toDataURL('image/png'), rect };
  } catch {
    // Tainted canvas, CORS refusal, or something we cannot rasterise. Fall back to the rect.
    return { rect };
  }
}

function findImage(srcUrl: string): Element | null {
  const images = Array.from(document.images).filter((image) => image.currentSrc === srcUrl || image.src === srcUrl);
  const visible = images.find((image) => {
    const box = image.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  return visible ?? images[0] ?? null;
}

function toElementRect(element: Element): ElementRect {
  const box = element.getBoundingClientRect();
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

const PANEL_STYLES = `
.qrp-panel {
  background: var(--qrp-bg);
  border: 1px solid var(--qrp-line);
  border-radius: var(--qrp-radius);
  box-shadow: 0 16px 40px rgba(12, 16, 26, 0.24), 0 0 0 0.5px rgba(12, 16, 26, 0.04);
  overflow: hidden;
  animation: qrp-enter 140ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes qrp-enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .qrp-panel { animation: none; } }

.qrp-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 10px 10px 13px;
  border-bottom: 1px solid var(--qrp-line);
  color: var(--qrp-muted);
}
.qrp-head svg { display: block; flex: none; }
.qrp-head-title { font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
.qrp-count { margin-left: auto; font-size: 11px; font-weight: 600; }
.qrp-close {
  appearance: none;
  display: inline-flex;
  border: 0;
  background: none;
  color: var(--qrp-muted);
  padding: 4px;
  border-radius: var(--qrp-radius);
  cursor: pointer;
}
.qrp-close:hover { color: var(--qrp-fg); background: var(--qrp-raised); }
.qrp-close:focus-visible { outline: 2px solid var(--qrp-accent); outline-offset: 1px; }

.qrp-body { padding: 13px; display: flex; flex-direction: column; gap: 13px; max-height: 72vh; overflow-y: auto; }
.qrp-body > .qrp-card + .qrp-card { border-top: 1px solid var(--qrp-line); padding-top: 13px; }
.qrp-foot { padding: 8px 13px 10px; border-top: 1px solid var(--qrp-line); font-size: 11px; color: var(--qrp-muted); }
.qrp-message { display: flex; flex-direction: column; gap: 6px; }
`;

/** Dim by default so several codes stay readable, bright for the card being looked at. */
const HIGHLIGHT_STYLE = [
  'position:fixed',
  'z-index:2147483646',
  'border:2px solid #2457d6',
  'border-radius:8px',
  'box-shadow:0 0 0 4px rgba(36,87,214,0.18)',
  'pointer-events:none',
  'opacity:0.4',
  'transition:opacity 120ms ease',
].join(';');

const HIGHLIGHT_DIM = '0.4';

function showOverlay(hits: ScanHit[], error?: string): void {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'z-index:2147483647',
    'width:344px',
    'max-width:calc(100vw - 32px)',
    'color-scheme:light dark',
  ].join(';');

  // The panel lives in a closed shadow root, which is right for isolation and leaves a test
  // with nothing to read. Test builds mirror the decoded text onto the host element; esbuild
  // drops this from shipped builds so no page ever sees it.
  if (__QRP_TEST__) host.dataset['qrpTestHits'] = JSON.stringify(hits.map((hit) => hit.text));

  const highlights = createHighlights(hits);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CARD_STYLES + PANEL_STYLES;

  const panel = document.createElement('div');
  panel.className = 'qrp qrp-panel';
  panel.append(head(hits.length), body(hits, error, highlights));
  if (hits.length > 0) panel.append(foot(hits.length));

  root.append(style, panel);
  document.documentElement.append(host);

  // Focusing the first action means Enter opens the link without reaching for the mouse.
  const firstOpen = root.querySelector<HTMLButtonElement>('[data-qrp-open]');
  (firstOpen ?? root.querySelector<HTMLButtonElement>('.qrp-close'))?.focus();

  document.addEventListener('keydown', onKeyDown, true);

  function head(count: number): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'qrp-head';
    const title = document.createElement('span');
    title.className = 'qrp-head-title';
    title.textContent = 'QR Peek';
    bar.append(icon('qr-code', 15), title);

    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'qrp-count';
      badge.textContent = `${count} codes`;
      bar.append(badge);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'qrp-close';
    close.setAttribute('aria-label', 'Close');
    close.append(icon('x', 15));
    close.addEventListener('click', dismiss);
    if (count <= 1) close.style.marginLeft = 'auto';
    bar.append(close);
    return bar;
  }

  function foot(count: number): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'qrp-foot';
    bar.textContent = count > 1 ? 'Enter opens the first link. Esc closes.' : 'Enter opens it. Esc closes.';
    return bar;
  }

  function dismiss(): void {
    document.removeEventListener('keydown', onKeyDown, true);
    highlights.destroy();
    host.remove();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
    }
  }
}

function body(hits: ScanHit[], error: string | undefined, highlights: Highlights): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'qrp-body';

  if (hits.length === 0) {
    const message = document.createElement('div');
    message.className = 'qrp-message';
    const head = document.createElement('div');
    head.className = 'qrp-kind';
    const label = document.createElement('span');
    label.className = 'qrp-kind-label';
    label.textContent = error ? 'Cannot scan' : 'Nothing found';
    head.append(icon(error ? 'warning' : 'magnifying-glass', 15), label);
    const detail = document.createElement('p');
    detail.className = 'qrp-secondary';
    detail.textContent =
      error ?? 'No QR code on the visible part of this page. Scroll the code into view, or right-click it and choose Scan QR code in this image.';
    message.append(head, detail);
    wrapper.append(message);
    return wrapper;
  }

  hits.forEach((hit, index) => {
    wrapper.append(
      renderResultCard(classify(hit.text), {
        onOpen: (url) => {
          void openLink(url, highlights);
        },
        onCopy: (value) => {
          void copyText(value).catch((error_: unknown) => {
            console.warn('[QR Peek] copy failed:', describe(error_));
          });
        },
        onHighlight: (active) => highlights.show(index, active),
      }),
    );
  });

  return wrapper;
}

/**
 * Only the background opens tabs, so a link click is a round trip. If that round trip fails,
 * which is what a rebuilt-but-not-reloaded extension looks like, the panel has to say so
 * rather than closing as though it worked.
 */
async function openLink(url: string, highlights: Highlights): Promise<void> {
  try {
    const response = await askBackground<OpenResponse>({ type: 'QRP_OPEN_URL', url } satisfies ToBackground);
    if (!response.ok) throw new Error(response.error ?? 'The background would not open it.');

    highlights.destroy();
    document.getElementById(HOST_ID)?.remove();
  } catch (error) {
    highlights.destroy();
    showOverlay([], `Could not open that link: ${describe(error)} Open the extensions page and press reload on QR Peek, then scan again.`);
  }
}

interface Highlights {
  show: (index: number, active: boolean) => void;
  destroy: () => void;
}

/**
 * Outlines each decoded code where it sits on the page. With several codes on screen this is
 * the only way to tell which card belongs to which code.
 */
function createHighlights(hits: ScanHit[]): Highlights {
  const ratio = window.devicePixelRatio || 1;
  const nodes = hits.map((hit) => {
    if (!hit.box) return null;
    const node = document.createElement('div');
    node.dataset['qrpHighlight'] = 'true';
    node.style.cssText = HIGHLIGHT_STYLE;
    node.style.left = `${hit.box.x / ratio}px`;
    node.style.top = `${hit.box.y / ratio}px`;
    node.style.width = `${hit.box.width / ratio}px`;
    node.style.height = `${hit.box.height / ratio}px`;
    document.documentElement.append(node);
    return node;
  });

  return {
    show(index, active) {
      const node = nodes[index];
      if (node) node.style.opacity = active ? '1' : HIGHLIGHT_DIM;
    },
    destroy() {
      for (const node of nodes) node?.remove();
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
