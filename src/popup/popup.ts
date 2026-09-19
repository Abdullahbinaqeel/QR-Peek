import api, { askBackground } from '../lib/browser';
import { icon } from '../lib/icons';
import type { ScanResponse, ToBackground } from '../lib/messages';
import { classify } from '../lib/payload';
import { CARD_STYLES, copyText, renderMessage, renderResultCard } from '../lib/resultCard';

const results = must<HTMLElement>('results');
const rescan = must<HTMLButtonElement>('rescan');
const hint = must<HTMLElement>('hint');

document.head.append(styleElement(CARD_STYLES));
must('head-icon').append(icon('qr-code', 15));
must('rescan-icon').append(icon('magnifying-glass', 14));

rescan.addEventListener('click', () => void scan());
document.addEventListener('keydown', onKeyDown);

void showShortcutHint();
void scan();

async function scan(): Promise<void> {
  rescan.disabled = true;
  results.setAttribute('aria-busy', 'true');
  results.replaceChildren(skeleton());

  try {
    // The background owns capture and decode, so the popup and the keyboard shortcut cannot
    // drift apart. activeTab is already granted by the click that opened this popup.
    const response = await askBackground<ScanResponse>({ type: 'QRP_SCAN_ACTIVE_TAB' } satisfies ToBackground);

    if (response.error) {
      show(renderMessage('warning', 'Cannot scan', response.error));
      return;
    }

    if (response.hits.length === 0) {
      show(
        renderMessage(
          'magnifying-glass',
          'Nothing found',
          'No QR code on the visible part of this page. Scroll the code into view and rescan, or right-click the code and choose Scan QR code in this image.',
        ),
      );
      return;
    }

    render(response.hits.map((hit) => hit.text));
  } catch (error) {
    show(
      renderMessage(
        'warning',
        'Scan failed',
        `${describe(error)} Open the extensions page and press reload on QR Peek, then try again.`,
      ),
    );
  } finally {
    rescan.disabled = false;
    results.setAttribute('aria-busy', 'false');
  }
}

function render(texts: string[]): void {
  results.replaceChildren();

  for (const text of texts) {
    results.append(
      renderResultCard(classify(text), {
        onOpen: (url) => {
          void api.tabs.create({ url });
          window.close();
        },
        onCopy: (value) => {
          void copyText(value).catch((error: unknown) => show(renderMessage('warning', 'Copy failed', describe(error))));
        },
      }),
    );
  }

  // Focus the first action so Enter opens the link straight away.
  results.querySelector<HTMLButtonElement>('[data-qrp-open]')?.focus();
  hint.textContent = texts.length > 1 ? `${texts.length} codes on screen. Enter opens the focused link.` : 'Enter opens it.';
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    window.close();
    return;
  }

  if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    results.querySelector<HTMLButtonElement>('[data-qrp-open]')?.click();
  }
}

function show(node: HTMLElement): void {
  results.replaceChildren(node);
  void showShortcutHint();
}

function skeleton(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'skeleton';
  block.setAttribute('aria-label', 'Scanning this tab');
  for (let index = 0; index < 4; index++) block.append(document.createElement('span'));
  return block;
}

function styleElement(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  return style;
}

async function showShortcutHint(): Promise<void> {
  try {
    const commands = await api.commands.getAll();
    const shortcut = commands.find((command) => command.name === 'scan-visible-tab')?.shortcut;
    hint.textContent = shortcut
      ? `${shortcut} scans without opening this popup. Right-click any image to scan it directly.`
      : 'Right-click any image to scan it directly.';
  } catch {
    hint.textContent = 'Right-click any image to scan it directly.';
  }
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Popup markup is missing #${id}`);
  return node as T;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
