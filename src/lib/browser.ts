/**
 * One promise-based extension API for every target.
 *
 * Safari and Firefox expose `browser` with promises; Chromium exposes `chrome`, which has
 * returned promises for MV3 APIs since Chrome 88. Everything else in this codebase imports
 * from here so no callback style leaks into feature code.
 */
declare const browser: typeof chrome | undefined;

const api: typeof chrome = (() => {
  const candidate = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : undefined;
  if (!candidate) throw new Error('No extension API available in this context');
  return candidate;
})();

export default api;

/** Pages where content scripts and tab capture are blocked by the browser itself. */
const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'brave://',
  'about:',
  'view-source:',
  'devtools://',
  'safari-web-extension://',
  'https://chromewebstore.google.com/',
  'https://chrome.google.com/webstore',
  'https://microsoftedge.microsoft.com/addons',
];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Sends a message to the background and insists on an answer.
 *
 * A Manifest V3 worker is torn down when idle, and the very message that wakes it can be
 * dropped, which surfaces as a resolved promise carrying nothing. One quick retry turns that
 * into a normal round trip rather than an error the user has to interpret.
 */
export async function askBackground<T>(message: unknown, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = (await api.runtime.sendMessage(message)) as T | undefined;
      if (response !== undefined) return response;
      lastError = new Error('The background did not answer.');
    } catch (error) {
      // "Could not establish connection" while the worker is still starting up.
      lastError = error;
    }

    await new Promise((done) => setTimeout(done, 120 * (attempt + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const RESTRICTED_PAGE_MESSAGE =
  'This browser blocks extensions from reading this page, so there is nothing to scan here. Open the QR code on a normal web page and try again.';
