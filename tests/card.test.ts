// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from '../src/lib/payload';
import { renderMessage, renderResultCard, type CardHandlers } from '../src/lib/resultCard';

function card(raw: string, handlers: Partial<CardHandlers> = {}): HTMLElement {
  const node = renderResultCard(classify(raw), {
    onOpen: handlers.onOpen ?? (() => {}),
    onCopy: handlers.onCopy ?? (() => {}),
    ...(handlers.onHighlight ? { onHighlight: handlers.onHighlight } : {}),
  });
  document.body.replaceChildren(node);
  return node;
}

const openButton = (node: HTMLElement) => node.querySelector<HTMLButtonElement>('[data-qrp-open]');
const chipText = (node: HTMLElement) => node.querySelector('.qrp-chip')?.textContent?.trim() ?? null;
const flagText = (node: HTMLElement) => node.querySelector('.qrp-flags')?.textContent ?? '';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('a safe link', () => {
  it('offers to open it, with no warnings attached', () => {
    const node = card('https://example.com/menu');
    expect(openButton(node)?.textContent).toContain('Open in new tab');
    expect(chipText(node)).toBeNull();
    expect(node.querySelector('.qrp-flags')).toBeNull();
  });

  it('gives the registrable domain the visual weight', () => {
    const node = card('https://login.accounts.example.com/reset');
    expect(node.querySelector('.qrp-focus')?.textContent).toBe('example.com');
    expect(node.querySelector('.qrp-primary')?.textContent).toBe('https://login.accounts.example.com/reset');
  });

  it('passes the parsed URL to the open handler, not the raw text', () => {
    const onOpen = vi.fn();
    const node = card('example.com/deals', { onOpen });
    openButton(node)?.click();
    expect(onOpen).toHaveBeenCalledWith('https://example.com/deals');
  });
});

describe('a link worth checking', () => {
  it('marks it, explains why, and still allows opening', () => {
    const node = card('http://192.168.1.50/admin');
    expect(chipText(node)).toBe('Check first');
    expect(openButton(node)).not.toBeNull();
    expect(flagText(node)).toMatch(/not encrypted/);
    expect(flagText(node)).toMatch(/bare IP address/);
    expect(node.querySelectorAll('.qrp-flag-caution')).toHaveLength(2);
  });

  it('says out loud when the code omitted the address prefix', () => {
    expect(card('example.com').querySelector('.qrp-note')?.textContent).toMatch(/left out the address prefix/);
  });
});

describe('a payload that is never opened', () => {
  it.each([
    ['javascript:alert(1)', 'Not opened'],
    ['file:///etc/passwd', 'Not opened'],
    ['chrome://settings', 'Not opened'],
  ])('%s has no open button at all', (raw, chip) => {
    const node = card(raw);
    expect(openButton(node)).toBeNull();
    expect(chipText(node)).toBe(chip);
    expect(node.querySelector('.qrp-flag-blocked')).not.toBeNull();
  });

  it.each(['WIFI:S:Cafe;T:WPA;P:secret;;', 'otpauth://totp/Example?secret=ABC&issuer=Example', 'tel:+441632960011'])(
    '%s is shown without an open button',
    (raw) => {
      expect(openButton(card(raw))).toBeNull();
    },
  );
});

describe('card behaviour', () => {
  it('copies the raw code, not the tidied display text', () => {
    const onCopy = vi.fn();
    const node = card('example.com/deals', { onCopy });
    const copy = node.querySelectorAll('button')[1]!;
    copy.click();
    expect(onCopy).toHaveBeenCalledWith('example.com/deals');
    expect(copy.textContent).toContain('Copied');
  });

  it('clamps a very long payload and can reveal the rest', () => {
    const node = card('x'.repeat(400));
    const line = node.querySelector('.qrp-primary')!;
    expect(line.classList.contains('qrp-primary-clamped')).toBe(true);

    const toggle = node.querySelector<HTMLButtonElement>('.qrp-btn-quiet')!;
    expect(toggle.textContent).toBe('Show everything');
    toggle.click();
    expect(line.classList.contains('qrp-primary-clamped')).toBe(false);
    expect(toggle.textContent).toBe('Show less');
  });

  it('does not clamp an ordinary link', () => {
    expect(card('https://example.com/a').querySelector('.qrp-primary-clamped')).toBeNull();
  });

  it('asks the surface to point at the code while the card has focus', () => {
    const onHighlight = vi.fn();
    const node = card('https://example.com', { onHighlight });
    node.dispatchEvent(new Event('focusin'));
    expect(onHighlight).toHaveBeenLastCalledWith(true);
    node.dispatchEvent(new Event('focusout'));
    expect(onHighlight).toHaveBeenLastCalledWith(false);
  });

  it('renders an icon for every payload kind', () => {
    for (const raw of ['https://example.com', 'WIFI:S:x;T:WPA;;', 'javascript:alert(1)', 'tel:+1', 'plain text']) {
      expect(card(raw).querySelector('svg')).not.toBeNull();
    }
  });
});

describe('messages', () => {
  it('renders a titled message block', () => {
    const node = renderMessage('magnifying-glass', 'Nothing found', 'No QR code on this page.');
    expect(node.textContent).toContain('Nothing found');
    expect(node.textContent).toContain('No QR code on this page.');
    expect(node.querySelector('svg')).not.toBeNull();
  });
});
