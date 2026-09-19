import { describe, expect, it } from 'vitest';
import { classify, type Payload } from '../src/lib/payload';

const openTarget = (payload: Payload) => payload.openUrl ?? null;

describe('links that are fine', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/path?q=1#frag', 'https://example.com/path?q=1#frag'],
    ['https://shop.sub.example.co/a', 'https://shop.sub.example.co/a'],
    // QR alphanumeric mode encodes uppercase only, so plenty of real codes look like this.
    ['HTTPS://EXAMPLE.COM/MENU', 'https://example.com/MENU'],
    ['https://example.com:443/secure', 'https://example.com/secure'],
    ['https://example.com/caf%C3%A9', 'https://example.com/caf%C3%A9'],
  ])('%s is safe and openable', (raw, expected) => {
    const payload = classify(raw);
    expect(payload.kind).toBe('url');
    expect(payload.risk).toBe('safe');
    expect(payload.warnings).toEqual([]);
    expect(openTarget(payload)).toBe(expected);
  });

  it('emphasises the registrable domain inside a long host', () => {
    expect(classify('https://login.accounts.example.com/x').emphasis).toMatchObject({
      before: 'https://login.accounts.',
      focus: 'example.com',
      after: '/x',
    });
  });

  it('does not flag the standard ports', () => {
    expect(classify('http://example.com:80/').warnings).toEqual([
      'This link is plain http, so the connection is not encrypted.',
    ]);
  });
});

describe('codes that leave out the address prefix', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['www.example.com/deals', 'https://www.example.com/deals'],
    ['shop.example.co.uk/item?id=7', 'https://shop.example.co.uk/item?id=7'],
  ])('%s opens over https', (raw, expected) => {
    const payload = classify(raw);
    expect(openTarget(payload)).toBe(expected);
    expect(payload.note).toMatch(/left out the address prefix/);
    expect(payload.risk).toBe('safe');
  });

  it('does not invent a link out of ordinary text', () => {
    for (const raw of ['example', 'www.example', 'version 2.0 of the plan', 'read chapter 4.1 first']) {
      expect(classify(raw).kind).toBe('text');
      expect(classify(raw).openUrl).toBeUndefined();
    }
  });
});

describe('malformed codes', () => {
  it.each([
    ['https://', 'text'],
    ['http://', 'text'],
    ['https://exa mple.com', 'text'],
    ['not a url at all', 'text'],
    ['123456789', 'text'],
    ['', 'text'],
    ['    ', 'text'],
  ])('%s degrades to plain text', (raw, kind) => {
    const payload = classify(raw);
    expect(payload.kind).toBe(kind);
    expect(payload.openUrl).toBeUndefined();
  });

  it('labels an empty code instead of showing a blank card', () => {
    expect(classify('')).toMatchObject({ kindLabel: 'Empty code', risk: 'safe' });
  });

  it('treats a typo scheme as unopenable rather than guessing', () => {
    const payload = classify('htp://example.com');
    expect(payload.openUrl).toBeUndefined();
    expect(payload.risk).toBe('caution');
    expect(payload.kindLabel).toBe('Unknown scheme: htp');
  });
});

describe('links worth a second look', () => {
  it('flags plain http but still allows opening', () => {
    const payload = classify('http://example.com/login');
    expect(payload.risk).toBe('caution');
    expect(openTarget(payload)).toBe('http://example.com/login');
    expect(payload.warnings[0]).toMatch(/not encrypted/);
  });

  it('flags a lookalike domain with its punycode form', () => {
    const payload = classify('https://аpple.com/login'); // Cyrillic "а"
    expect(payload.risk).toBe('caution');
    expect(payload.warnings.join(' ')).toMatch(/xn--pple-43d\.com/);
    expect(openTarget(payload)).toBeTruthy();
  });

  it('flags credentials used to disguise the real host', () => {
    const payload = classify('https://www.paypal.com@evil.example/login');
    expect(payload.warnings.join(' ')).toMatch(/before the "@"/);
    expect(payload.secondary).toBe('evil.example');
  });

  it.each([
    ['http://192.168.1.50/admin', /bare IP address/],
    ['https://[2001:db8::1]/panel', /bare IP address/],
    ['https://bit.ly/3xYzAb', /shortened link/],
    ['https://example.com:8443/panel', /port 8443/],
  ])('%s is flagged', (raw, matcher) => {
    const payload = classify(raw);
    expect(payload.risk).toBe('caution');
    expect(payload.warnings.join(' ')).toMatch(matcher);
  });

  it('puts the weight on the real domain when the brand is only a subdomain', () => {
    // The browser lands on evil.example; the card has to say so louder than the prefix does.
    expect(classify('https://paypal.com.evil.example/login')).toMatchObject({
      emphasis: { before: 'https://paypal.com.', focus: 'evil.example', after: '/login' },
      secondary: 'paypal.com.evil.example',
    });
  });

  it('stacks every reason it found', () => {
    const payload = classify('http://10.0.0.9:8080/reset');
    expect(payload.warnings).toHaveLength(3);
  });
});

describe('codes that are never opened', () => {
  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/9a1f',
    'chrome://settings/passwords',
    'chrome-extension://abcdefg/page.html',
    'about:config',
    'view-source:https://example.com',
  ])('%s is blocked', (raw) => {
    const payload = classify(raw);
    expect(payload.risk).toBe('blocked');
    expect(payload.openUrl).toBeUndefined();
    expect(payload.warnings.join(' ')).toMatch(/will not be opened/);
  });
});

describe('codes that are not web links', () => {
  it('treats a two-factor code as a secret, not a link', () => {
    const payload = classify('otpauth://totp/Example:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(payload).toMatchObject({ kind: 'otp', risk: 'caution', secondary: 'Issuer: Example' });
    expect(payload.openUrl).toBeUndefined();
    expect(payload.warnings.join(' ')).toMatch(/two-factor secret/);
  });

  it.each([
    ['bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.077', 'Amount: 0.077'],
    ['upi://pay?pa=merchant@bank&am=4500', 'Amount: 4500'],
  ])('%s is a payment request, never opened', (raw, secondary) => {
    const payload = classify(raw);
    expect(payload).toMatchObject({ kind: 'payment', risk: 'caution', secondary });
    expect(payload.openUrl).toBeUndefined();
  });

  it.each(['intent://scan/#Intent;scheme=zxing;end', 'market://details?id=com.example.app'])(
    '%s is shown as an app link',
    (raw) => {
      expect(classify(raw)).toMatchObject({ kind: 'app', risk: 'caution' });
    },
  );

  it('parses wifi payloads, including escaped separators', () => {
    expect(classify(String.raw`WIFI:T:WPA;S:Cafe\; Gruen;P:p\:ssword;H:false;;`)).toMatchObject({
      kind: 'wifi',
      risk: 'safe',
      primary: 'Cafe; Gruen',
      secondary: 'Secured with WPA',
    });
  });

  it('warns about an open wifi network', () => {
    const payload = classify('WIFI:S:FreeAirportWifi;T:nopass;;');
    expect(payload.risk).toBe('caution');
    expect(payload.secondary).toBe('Open network, no password');
  });

  it.each([
    ['BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nORG:Analytical Engines;R&D\nEND:VCARD', 'Ada Lovelace'],
    ['MECARD:N:Ada Lovelace;TEL:+441632960011;;', 'Ada Lovelace'],
  ])('reads a contact card', (raw, name) => {
    expect(classify(raw)).toMatchObject({ kind: 'contact', primary: name });
  });

  it('reads a calendar event', () => {
    const raw = 'BEGIN:VEVENT\nSUMMARY:Standup\nDTSTART:20260401T090000Z\nEND:VEVENT';
    expect(classify(raw)).toMatchObject({ kind: 'calendar', primary: 'Standup', secondary: '20260401T090000Z' });
  });

  it.each([
    ['mailto:ada@example.com?subject=Invoice%2042', 'email', 'ada@example.com', 'Subject: Invoice 42'],
    ['MATMSG:TO:ada@example.com;SUB:Invoice;BODY:Attached;;', 'email', 'ada@example.com', 'Invoice'],
    ['tel:+441632960011', 'phone', '+441632960011', undefined],
    ['sms:+441632960011', 'sms', '+441632960011', undefined],
    ['SMSTO:+441632960011:On my way', 'sms', '+441632960011', 'On my way'],
    ['geo:52.5200,13.4050', 'geo', '52.5200,13.4050', undefined],
  ])('%s is read as %s', (raw, kind, primary, secondary) => {
    const payload = classify(raw);
    expect(payload).toMatchObject({ kind, primary });
    expect(payload.secondary).toBe(secondary);
    expect(payload.openUrl).toBeUndefined();
  });

  it('keeps a long plain-text payload intact', () => {
    const raw = 'Lorem ipsum dolor sit amet, '.repeat(12).trim();
    expect(classify(raw)).toMatchObject({ kind: 'text', primary: raw, risk: 'safe' });
  });
});
