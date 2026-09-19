import type { IconName } from './icons';

export type PayloadKind =
  | 'url'
  | 'wifi'
  | 'contact'
  | 'email'
  | 'phone'
  | 'sms'
  | 'geo'
  | 'otp'
  | 'payment'
  | 'app'
  | 'calendar'
  | 'text';

/**
 * safe    - a plain web link with nothing odd about it.
 * caution - openable or readable, but something about it deserves a second look.
 * blocked - the extension will not open this, whatever the user clicks.
 */
export type Risk = 'safe' | 'caution' | 'blocked';

/** Splits a URL so the registrable domain can be emphasised in the middle of the string. */
export interface Emphasis {
  before: string;
  focus: string;
  after: string;
}

export interface Payload {
  kind: PayloadKind;
  risk: Risk;
  raw: string;
  kindLabel: string;
  icon: IconName;
  primary: string;
  secondary?: string;
  emphasis?: Emphasis;
  /** Short, plain-language reasons the user should look twice. */
  warnings: string[];
  /** Neutral information about how we read the code, not a warning. */
  note?: string;
  /** Present only when the extension is willing to navigate here on a click. */
  openUrl?: string;
}

/** Schemes that can run code, read local files or reach browser internals. Never opened. */
const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'jar:',
  'view-source:',
  'chrome:',
  'chrome-extension:',
  'edge:',
  'brave:',
  'about:',
  'safari-web-extension:',
  'moz-extension:',
]);

/** Link shorteners hide their destination, which is the whole point of them. */
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  't.ly',
  'lnkd.in',
  'rb.gy',
  'shorte.st',
  'adf.ly',
  'qr.ae',
  'v.gd',
  's.id',
]);

const PAYMENT_SCHEMES = new Set(['bitcoin:', 'ethereum:', 'litecoin:', 'monero:', 'upi:', 'lightning:']);
const APP_SCHEMES = new Set(['intent:', 'market:', 'itms-apps:', 'android-app:', 'fb:', 'whatsapp:', 'tg:']);

/**
 * A bare domain with no scheme. QR codes carry these constantly ("example.com/offer") because
 * the shorter alphanumeric encoding fits more data, so treating them as plain text would fail
 * a large share of real codes.
 */
const BARE_DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?<tld>[a-z]{2,24})(?::\d{1,5})?(?<rest>[/?#][^\s]*)?$/i;

/**
 * Without this gate any two words joined by a dot ("www.example", "report.final", "photo.png")
 * would be read as a web address. Two-letter country codes are accepted wholesale; everything
 * else has to be a gTLD we know, or carry a path, which ordinary prose does not.
 */
const KNOWN_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name', 'pro',
  'io', 'ai', 'app', 'dev', 'xyz', 'site', 'online', 'shop', 'store', 'tech', 'cloud',
  'link', 'page', 'live', 'news', 'blog', 'art', 'design', 'agency', 'studio', 'media',
  'email', 'games', 'group', 'life', 'ltd', 'menu', 'money', 'network', 'today', 'works',
  'world', 'zone', 'travel', 'photo', 'video', 'wiki', 'club', 'fun', 'space', 'website',
]);

function looksLikeDomain(value: string): boolean {
  const match = BARE_DOMAIN.exec(value);
  const tld = match?.groups?.['tld']?.toLowerCase();
  if (!tld) return false;
  return tld.length === 2 || KNOWN_TLDS.has(tld) || Boolean(match?.groups?.['rest']);
}

export function classify(raw: string): Payload {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return base('text', 'Empty code', 'text-aa', '(this code contains no data)', raw);
  }

  if (/^WIFI:/i.test(trimmed)) return classifyWifi(trimmed, raw);
  if (/^BEGIN:VCARD/i.test(trimmed) || /^MECARD:/i.test(trimmed)) return classifyContact(trimmed, raw);
  if (/^BEGIN:VEVENT/i.test(trimmed)) return classifyEvent(trimmed, raw);
  if (/^MATMSG:/i.test(trimmed)) return classifyMatMsg(trimmed, raw);
  if (/^SMSTO:/i.test(trimmed)) return classifySmsTo(trimmed, raw);

  const direct = parseUrl(trimmed);
  if (direct) return classifyUrl(direct, raw, false);

  if (looksLikeDomain(trimmed)) {
    const assumed = parseUrl(`https://${trimmed}`);
    if (assumed) return classifyUrl(assumed, raw, true);
  }

  return base('text', 'Text', 'text-aa', trimmed, raw);
}

function base(kind: PayloadKind, kindLabel: string, icon: IconName, primary: string, raw: string): Payload {
  return { kind, risk: 'safe', raw, kindLabel, icon, primary, warnings: [] };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function classifyUrl(url: URL, raw: string, schemeAssumed: boolean): Payload {
  if (url.protocol === 'http:' || url.protocol === 'https:') return classifyWebLink(url, raw, schemeAssumed);

  const scheme = url.protocol.replace(':', '');

  if (BLOCKED_SCHEMES.has(url.protocol)) {
    return {
      kind: 'text',
      risk: 'blocked',
      raw,
      kindLabel: `Blocked: ${scheme}`,
      icon: 'prohibit',
      primary: raw.trim(),
      warnings: [`Codes using "${scheme}" can run code or reach local files. This one will not be opened.`],
    };
  }

  if (url.protocol === 'mailto:') {
    const address = decodeSafely(url.pathname);
    const subject = new URLSearchParams(url.search).get('subject');
    return {
      ...base('email', 'Email address', 'envelope-simple', address || raw.trim(), raw),
      secondary: subject ? `Subject: ${subject}` : undefined,
    };
  }

  if (url.protocol === 'tel:') {
    return base('phone', 'Phone number', 'phone', decodeSafely(url.pathname) || raw.trim(), raw);
  }

  if (url.protocol === 'sms:' || url.protocol === 'smsto:') {
    return base('sms', 'Text message', 'chat-teardrop-text', decodeSafely(url.pathname) || raw.trim(), raw);
  }

  if (url.protocol === 'geo:') {
    return base('geo', 'Location', 'map-pin', decodeSafely(url.pathname) || raw.trim(), raw);
  }

  if (url.protocol === 'otpauth:') {
    // The secret is the whole credential. Never open it, and say why it matters.
    const label = decodeSafely(url.pathname.replace(/^\/+/, ''));
    const issuer = new URLSearchParams(url.search).get('issuer');
    return {
      kind: 'otp',
      risk: 'caution',
      raw,
      kindLabel: 'Two-factor setup code',
      icon: 'key',
      primary: label || raw.trim(),
      secondary: issuer ? `Issuer: ${issuer}` : undefined,
      warnings: [
        'This code carries a two-factor secret. Anyone who copies it can generate your login codes, so only scan it into your authenticator app.',
      ],
    };
  }

  if (PAYMENT_SCHEMES.has(url.protocol)) {
    const amount = new URLSearchParams(url.search).get('amount') ?? new URLSearchParams(url.search).get('am');
    return {
      kind: 'payment',
      risk: 'caution',
      raw,
      kindLabel: `Payment request (${scheme})`,
      icon: 'currency-circle-dollar',
      primary: decodeSafely(url.pathname) || raw.trim(),
      secondary: amount ? `Amount: ${amount}` : undefined,
      warnings: ['Payment codes are a common scam. Check the recipient and amount in your wallet app before sending anything.'],
    };
  }

  if (APP_SCHEMES.has(url.protocol)) {
    return {
      kind: 'app',
      risk: 'caution',
      raw,
      kindLabel: `App link (${scheme})`,
      icon: 'app-window',
      primary: raw.trim(),
      warnings: ['This code opens an app rather than a web page, so the extension shows it as text.'],
    };
  }

  if (url.protocol === 'webcal:') {
    return base('calendar', 'Calendar subscription', 'calendar-blank', raw.trim(), raw);
  }

  return {
    kind: 'text',
    risk: 'caution',
    raw,
    kindLabel: `Unknown scheme: ${scheme}`,
    icon: 'warning',
    primary: raw.trim(),
    warnings: ['This is not a web address the extension recognises, so it is shown as text only.'],
  };
}

function classifyWebLink(url: URL, raw: string, schemeAssumed: boolean): Payload {
  const warnings: string[] = [];

  if (url.protocol === 'http:') {
    warnings.push('This link is plain http, so the connection is not encrypted.');
  }

  // The URL parser punycodes non-Latin hosts. Showing that form is the only cheap defence
  // against a lookalike domain that renders identically to one the user trusts.
  if (url.hostname.split('.').some((label) => label.startsWith('xn--'))) {
    warnings.push(`This domain is not plain Latin text. Its real form is "${url.hostname}", which can be a lookalike of a name you know.`);
  }

  if (url.username || url.password) {
    warnings.push('Everything before the "@" is ignored by the browser, so the real destination is the part after it.');
  }

  if (isIpHost(url.hostname)) {
    warnings.push('This link points at a bare IP address rather than a named site.');
  }

  if (SHORTENERS.has(url.hostname.replace(/^www\./, ''))) {
    warnings.push('This is a shortened link, so the real destination stays hidden until it opens.');
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    warnings.push(`It connects on port ${url.port} rather than the standard web port.`);
  }

  return {
    kind: 'url',
    risk: warnings.length > 0 ? 'caution' : 'safe',
    raw,
    kindLabel: url.protocol === 'http:' ? 'Web link, not secure' : 'Web link',
    icon: url.protocol === 'http:' ? 'lock-simple-open' : 'link-simple',
    primary: url.href,
    secondary: url.host,
    emphasis: emphasise(url),
    warnings,
    note: schemeAssumed ? 'The code left out the address prefix, so this opens over https.' : undefined,
    openUrl: url.href,
  };
}

function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
}

/** Emphasises the registrable part of the host inside the full URL string. */
function emphasise(url: URL): Emphasis | undefined {
  const hostStart = url.href.indexOf(url.host);
  if (hostStart < 0) return undefined;

  const labels = url.hostname.split('.');
  const focusHost = labels.length > 2 ? labels.slice(-2).join('.') : url.hostname;
  const focusStart = url.href.indexOf(focusHost, hostStart);
  if (focusStart < 0) return undefined;

  return {
    before: url.href.slice(0, focusStart),
    focus: focusHost,
    after: url.href.slice(focusStart + focusHost.length),
  };
}

/** WIFI:T:WPA;S:my ssid;P:secret;H:false;; with backslash-escaped separators inside values. */
function classifyWifi(trimmed: string, raw: string): Payload {
  const fields = parseEscapedFields(trimmed.slice('WIFI:'.length));
  const ssid = fields.get('S') ?? '(hidden network)';
  const security = (fields.get('T') || 'nopass').toUpperCase();
  const open = security === 'NOPASS';

  return {
    kind: 'wifi',
    risk: open ? 'caution' : 'safe',
    raw,
    kindLabel: 'Wi-Fi network',
    icon: 'wifi-high',
    primary: ssid,
    secondary: open ? 'Open network, no password' : `Secured with ${security}`,
    warnings: open ? ['This network has no password, so anything you send over it can be read by others nearby.'] : [],
  };
}

function classifyContact(trimmed: string, raw: string): Payload {
  if (/^MECARD:/i.test(trimmed)) {
    const fields = parseEscapedFields(trimmed.slice('MECARD:'.length));
    return {
      ...base('contact', 'Contact card', 'user-circle', fields.get('N') ?? 'Contact card', raw),
      secondary: fields.get('TEL') ?? fields.get('EMAIL'),
    };
  }

  const name = /^FN[^:]*:(.+)$/im.exec(trimmed)?.[1]?.trim();
  const org = /^ORG[^:]*:(.+)$/im.exec(trimmed)?.[1]?.trim();
  return {
    ...base('contact', 'Contact card', 'user-circle', name || 'Contact card', raw),
    secondary: org?.replaceAll(';', ' ').trim(),
  };
}

function classifyEvent(trimmed: string, raw: string): Payload {
  const summary = /^SUMMARY[^:]*:(.+)$/im.exec(trimmed)?.[1]?.trim();
  const start = /^DTSTART[^:]*:(.+)$/im.exec(trimmed)?.[1]?.trim();
  return {
    ...base('calendar', 'Calendar event', 'calendar-blank', summary || 'Calendar event', raw),
    secondary: start,
  };
}

function classifyMatMsg(trimmed: string, raw: string): Payload {
  const fields = parseEscapedFields(trimmed.slice('MATMSG:'.length));
  return {
    ...base('email', 'Email message', 'envelope-simple', fields.get('TO') ?? 'Email message', raw),
    secondary: fields.get('SUB'),
  };
}

function classifySmsTo(trimmed: string, raw: string): Payload {
  const [number, body] = trimmed.slice('SMSTO:'.length).split(':');
  return {
    ...base('sms', 'Text message', 'chat-teardrop-text', number ?? raw.trim(), raw),
    secondary: body,
  };
}

/** Shared parser for the KEY:value;KEY:value;; formats, honouring backslash escapes. */
function parseEscapedFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let key = '';
  let value = '';
  let readingKey = true;

  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '\\') {
      value += body[++index] ?? '';
      continue;
    }
    if (char === ':' && readingKey) {
      readingKey = false;
      continue;
    }
    if (char === ';') {
      if (key) fields.set(key.toUpperCase(), value);
      key = '';
      value = '';
      readingKey = true;
      continue;
    }
    if (readingKey) key += char;
    else value += char;
  }
  if (key) fields.set(key.toUpperCase(), value);

  return fields;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
