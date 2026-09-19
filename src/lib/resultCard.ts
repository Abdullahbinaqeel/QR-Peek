import { icon, type IconName } from './icons';
import type { Payload } from './payload';

export interface CardHandlers {
  onOpen: (url: string) => void;
  onCopy: (text: string) => void;
  /** Called when the card is focused or hovered, so a surface can point at the code on screen. */
  onHighlight?: (active: boolean) => void;
}

/**
 * One stylesheet for both surfaces: the popup document and a shadow root injected into an
 * arbitrary page. Tokens hang off `.qrp` so they resolve in either.
 *
 * Shape rule: pill for chips, 10px for every other surface and control.
 * Colour rule: one accent (blue) for actions; amber and red are state only, never decoration.
 */
export const CARD_STYLES = `
.qrp {
  --qrp-bg: #ffffff;
  --qrp-raised: #f7f8fa;
  --qrp-fg: #16181d;
  --qrp-muted: #616779;
  --qrp-line: #e2e5ec;
  --qrp-accent: #2457d6;
  --qrp-accent-fg: #ffffff;
  --qrp-accent-soft: #eef2fe;
  --qrp-caution: #8a5a00;
  --qrp-caution-bg: #fdf4e3;
  --qrp-caution-line: #edd3a0;
  --qrp-danger: #a32218;
  --qrp-danger-bg: #fdefed;
  --qrp-danger-line: #f1c3bd;
  --qrp-radius: 10px;
  --qrp-shadow: 0 1px 2px rgba(20, 24, 35, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--qrp-fg);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .qrp {
    --qrp-bg: #16181d;
    --qrp-raised: #1e2129;
    --qrp-fg: #f1f3f8;
    --qrp-muted: #9aa1b4;
    --qrp-line: #2c303a;
    --qrp-accent: #8fadff;
    --qrp-accent-fg: #10131a;
    --qrp-accent-soft: #212940;
    --qrp-caution: #f2c377;
    --qrp-caution-bg: #2f2718;
    --qrp-caution-line: #574a2a;
    --qrp-danger: #f5a79c;
    --qrp-danger-bg: #331d1a;
    --qrp-danger-line: #5c2f29;
    --qrp-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
}

.qrp-card { display: flex; flex-direction: column; gap: 10px; }
.qrp-card svg { display: block; flex: none; }

.qrp-kind { display: flex; align-items: center; gap: 7px; color: var(--qrp-muted); }
.qrp-kind-label { font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
.qrp-chip {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 3px 9px 3px 7px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.qrp-chip-caution { background: var(--qrp-caution-bg); color: var(--qrp-caution); }
.qrp-chip-blocked { background: var(--qrp-danger-bg); color: var(--qrp-danger); }

.qrp-primary {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.qrp-primary-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qrp-focus { font-weight: 680; }
.qrp-dim { color: var(--qrp-muted); }
.qrp-expandable { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.qrp-secondary { margin: 0; font-size: 12px; color: var(--qrp-muted); overflow-wrap: anywhere; }
.qrp-note { margin: 0; font-size: 12px; color: var(--qrp-muted); }

.qrp-flags { display: flex; flex-direction: column; gap: 6px; }
.qrp-flag {
  display: flex;
  gap: 8px;
  border-radius: var(--qrp-radius);
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.45;
}
.qrp-flag-caution { background: var(--qrp-caution-bg); color: var(--qrp-caution); border: 1px solid var(--qrp-caution-line); }
.qrp-flag-blocked { background: var(--qrp-danger-bg); color: var(--qrp-danger); border: 1px solid var(--qrp-danger-line); }
.qrp-flag svg { margin-top: 1px; }

.qrp-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qrp-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--qrp-line);
  background: var(--qrp-bg);
  color: var(--qrp-fg);
  border-radius: var(--qrp-radius);
  padding: 8px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.qrp-btn:hover { background: var(--qrp-raised); }
.qrp-btn:active { transform: scale(0.98); }
.qrp-btn:focus-visible { outline: 2px solid var(--qrp-accent); outline-offset: 2px; }
.qrp-btn-primary { background: var(--qrp-accent); border-color: var(--qrp-accent); color: var(--qrp-accent-fg); }
.qrp-btn-primary:hover { background: var(--qrp-accent); filter: brightness(1.06); }
.qrp-btn-quiet { border-color: transparent; padding-left: 8px; padding-right: 8px; color: var(--qrp-muted); }
.qrp-btn-quiet:hover { color: var(--qrp-fg); }

@media (prefers-reduced-motion: reduce) {
  .qrp-btn { transition: none; }
  .qrp-btn:active { transform: none; }
}
`;

const CHIP_TEXT: Record<'caution' | 'blocked', string> = {
  caution: 'Check first',
  blocked: 'Not opened',
};

export function renderResultCard(payload: Payload, handlers: CardHandlers): HTMLElement {
  const card = element('div', 'qrp-card');

  card.append(kindRow(payload));
  card.append(primaryLine(payload));

  if (payload.secondary) card.append(text('p', 'qrp-secondary', payload.secondary));
  if (payload.note) card.append(text('p', 'qrp-note', payload.note));
  if (payload.warnings.length > 0) card.append(flags(payload));

  card.append(actions(payload, handlers));

  if (handlers.onHighlight) {
    card.addEventListener('pointerenter', () => handlers.onHighlight?.(true));
    card.addEventListener('pointerleave', () => handlers.onHighlight?.(false));
    card.addEventListener('focusin', () => handlers.onHighlight?.(true));
    card.addEventListener('focusout', () => handlers.onHighlight?.(false));
  }

  return card;
}

function kindRow(payload: Payload): HTMLElement {
  const row = element('div', 'qrp-kind');
  row.append(icon(payload.icon, 15), text('span', 'qrp-kind-label', payload.kindLabel));

  if (payload.risk !== 'safe') {
    const chip = element('span', `qrp-chip qrp-chip-${payload.risk}`);
    chip.append(icon(payload.risk === 'blocked' ? 'prohibit' : 'shield-warning', 12));
    chip.append(document.createTextNode(CHIP_TEXT[payload.risk]));
    row.append(chip);
  }

  return row;
}

/** Long payloads are clamped to three lines with an explicit way to see the rest. */
function primaryLine(payload: Payload): HTMLElement {
  const line = element('p', 'qrp-primary');

  if (payload.emphasis) {
    // The registrable domain is the only part of a URL that decides where you land,
    // so it is the part that gets weight.
    line.append(
      text('span', 'qrp-dim', payload.emphasis.before),
      text('span', 'qrp-focus', payload.emphasis.focus),
      text('span', 'qrp-dim', payload.emphasis.after),
    );
  } else {
    line.textContent = payload.primary;
  }

  if (payload.primary.length <= 140) return line;

  line.classList.add('qrp-primary-clamped');
  const wrapper = element('div', 'qrp-expandable');
  const toggle = text('button', 'qrp-btn qrp-btn-quiet', 'Show everything');
  toggle.setAttribute('type', 'button');
  toggle.addEventListener('click', () => {
    const clamped = line.classList.toggle('qrp-primary-clamped');
    toggle.textContent = clamped ? 'Show everything' : 'Show less';
  });
  wrapper.append(line, toggle);
  return wrapper;
}

function flags(payload: Payload): HTMLElement {
  const list = element('div', 'qrp-flags');
  const tone = payload.risk === 'blocked' ? 'blocked' : 'caution';

  for (const warning of payload.warnings) {
    const flag = element('div', `qrp-flag qrp-flag-${tone}`);
    flag.append(icon(tone === 'blocked' ? 'prohibit' : 'warning', 14), text('span', '', warning));
    list.append(flag);
  }

  return list;
}

function actions(payload: Payload, handlers: CardHandlers): HTMLElement {
  const row = element('div', 'qrp-actions');

  if (payload.openUrl) {
    const openUrl = payload.openUrl;
    const open = element('button', 'qrp-btn qrp-btn-primary');
    open.setAttribute('type', 'button');
    open.dataset.qrpOpen = 'true';
    open.append(icon('arrow-square-out', 15), document.createTextNode('Open in new tab'));
    open.addEventListener('click', () => handlers.onOpen(openUrl));
    row.append(open);
  }

  const copy = element('button', 'qrp-btn');
  copy.setAttribute('type', 'button');
  const copyIcon = icon('copy-simple', 15);
  const copyLabel = document.createTextNode('Copy');
  copy.append(copyIcon, copyLabel);
  copy.addEventListener('click', () => {
    handlers.onCopy(payload.raw);
    copyIcon.replaceWith(icon('check', 15));
    copyLabel.textContent = 'Copied';
    setTimeout(() => {
      copy.replaceChildren(icon('copy-simple', 15), document.createTextNode('Copy'));
    }, 1400);
  });
  row.append(copy);

  return row;
}

export function renderMessage(name: IconName, title: string, body: string): HTMLElement {
  const block = element('div', 'qrp-message');
  const head = element('div', 'qrp-kind');
  head.append(icon(name, 15), text('span', 'qrp-kind-label', title));
  block.append(head, text('p', 'qrp-secondary', body));
  return block;
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const node = element(tag, className);
  node.textContent = content;
  return node;
}

/** Copy that works in the popup and inside a page, with a documented fallback. */
export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch (error) {
    // The Clipboard API is blocked in some page contexts (no transient activation, or a
    // restrictive permissions policy). Fall back rather than failing silently.
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
