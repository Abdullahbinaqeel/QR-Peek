import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { CODES, CROSS_ORIGIN_CODE, SMALL_CODE } from './fixtures.mjs';

const wasmBinary = await readFile(resolve(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
prepareZXingModule({ overrides: { wasmBinary: wasmBinary.buffer }, fireImmediately: false });

/** Decodes a data URL the page handed back, to prove those pixels really are the code. */
async function decodeDataUrl(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const results = await readBarcodes(blob, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 });
  return results.map((result) => result.text);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class Session {
  #ws;
  #id = 0;
  #pending = new Map();

  static async open(wsUrl) {
    const session = new Session();
    session.#ws = new WebSocket(wsUrl, { maxPayload: 1 << 28 });
    await new Promise((resolve, reject) => {
      session.#ws.once('open', resolve);
      session.#ws.once('error', reject);
    });
    session.#ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const pending = session.#pending.get(message.id);
      if (!pending) return;
      session.#pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
    return session;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close() {
    this.#ws.close();
  }
}

export async function runChecks({ cdpBase, extensionId, siteUrl, crossOriginUrl }) {
  const results = [];
  const check = (name, passed, detail = '') => {
    results.push(passed);
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };

  const targets = async () => (await fetch(`${cdpBase}/json/list`)).json();

  async function waitForTarget(predicate, label, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = (await targets()).find(predicate);
      if (found) return found;
      await sleep(300);
    }
    throw new Error(`timed out waiting for target: ${label}`);
  }

  const isWorker = (target) => target.url.endsWith('/background/index.js');

  /** An MV3 worker idles out after ~30 seconds; opening one of its own pages wakes it up. */
  async function wakeWorker() {
    const version = await (await fetch(`${cdpBase}/json/version`)).json();
    const browserSession = await Session.open(version.webSocketDebuggerUrl);
    const { targetId } = await browserSession.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup/index.html`,
    });
    await sleep(1500);
    await browserSession.send('Target.closeTarget', { targetId });
    browserSession.close();
  }

  if (!(await targets()).some(isWorker)) await wakeWorker();

  async function attachWorker() {
    const target = await waitForTarget(isWorker, 'extension service worker');
    const session = await Session.open(target.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    return session;
  }

  let sw = await attachWorker();

  // An idle worker can be torn down between attach and evaluate, leaving a stale context.
  // Waking it through one of its own pages and re-attaching is enough to recover.
  const swEvaluate = async (expression) => {
    try {
      return await sw.evaluate(expression);
    } catch (error) {
      if (!/chrome is not defined|Cannot find context|Target closed/i.test(String(error))) throw error;
      await wakeWorker();
      sw.close();
      sw = await attachWorker();
      return sw.evaluate(expression);
    }
  };

  const listeners = await swEvaluate(`(async () => ({
    hasCommand: chrome.commands.onCommand.hasListeners(),
    hasMenu: chrome.contextMenus.onClicked.hasListeners(),
    hasMessage: chrome.runtime.onMessage.hasListeners(),
  }))()`);
  check(
    'service worker registers command, menu and message listeners',
    listeners.hasCommand && listeners.hasMenu && listeners.hasMessage,
    JSON.stringify(listeners),
  );

  const commands = await swEvaluate(`chrome.commands.getAll().then(c => JSON.stringify(c))`);
  check('keyboard shortcut is bound', /"name":"scan-visible-tab","shortcut":".+"/.test(commands), commands);

  const pageTarget = await waitForTarget((t) => t.type === 'page' && t.url.startsWith(siteUrl), 'test page');
  const page = await Session.open(pageTarget.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  const tabId = await swEvaluate(`chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0].id)`);

  // runtime.sendMessage never reaches the sender's own worker, so messages aimed at the
  // background have to originate from a page. An extension page is the closest stand-in
  // for the popup, which cannot be clicked programmatically.
  const helperUrl = `chrome-extension://${extensionId}/popup/index.html`;
  await swEvaluate(`chrome.tabs.create({ url: '${helperUrl}', active: false }).then(t => t.id)`);
  const helperTarget = await waitForTarget((t) => t.type === 'page' && t.url === helperUrl, 'helper extension page');
  const helper = await Session.open(helperTarget.webSocketDebuggerUrl);
  await helper.send('Runtime.enable');

  // A screenshot of a page that has not painted yet contains nothing to decode, and a fixed
  // delay is a guess. Wait for the page to be genuinely ready, then let the scan settle.
  await page.evaluate(`(async () => {
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
    await Promise.all(Array.from(document.images).map(img => img.complete ? null : img.decode().catch(() => null)));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);

  // The whole pipeline against a live tab: capture -> decode -> hits.
  const runScan = () => helper.evaluate(`(async () => {
    const [target] = await chrome.tabs.query({ url: '${siteUrl}*' });
    await chrome.tabs.update(target.id, { active: true });
    await new Promise(r => setTimeout(r, 400));
    return chrome.runtime.sendMessage({ type: 'QRP_SCAN_ACTIVE_TAB' });
  })()`);

  let scan = await runScan();
  for (let attempt = 0; attempt < 8 && (scan.hits ?? []).length === 0; attempt++) {
    // The tab can still be compositing its first frame, especially on a headless runner.
    await sleep(700);
    scan = await runScan();
  }
  const found = (scan.hits ?? []).map((hit) => hit.text);
  check('the page under test is fully rendered before anything is asserted', found.length > 0, `${found.length} codes`);
  for (const code of CODES) {
    check(`background decodes the ${code.label} code`, found.includes(code.text), code.text.slice(0, 44));
  }
  check('background reports where each code sits on screen', (scan.hits ?? []).every((hit) => hit.box?.width > 0));

  // Popup rendering. action.openPopup() needs a focused OS window, which a headless run does
  // not have, so the popup page is driven directly: same document, same script, same message to
  // the background as a real toolbar click. It stays a background tab in the window that holds
  // the codes, because cross-window focus is not dependable without a window manager.
  await swEvaluate(`(async () => {
    const [target] = await chrome.tabs.query({ url: '${siteUrl}*' });
    await chrome.tabs.update(target.id, { active: true });
  })()`);
  await sleep(400);
  await helper.evaluate(`document.getElementById('rescan').click()`);

  for (let attempt = 0; attempt < 40; attempt++) {
    if (await helper.evaluate(`document.querySelectorAll('.qrp-card').length > 0`)) break;
    await sleep(500);
  }

  const cards = await helper.evaluate(`document.querySelectorAll('.qrp-card').length`);
  check('popup renders one card per decoded code', cards === found.length, `${cards} cards for ${found.length} codes`);

  // Every code on the fixture page is a web link except the script payload and the wifi code.
  const expectedOpenable = found.filter((text) => !text.startsWith('javascript:') && !text.startsWith('WIFI:')).length;
  const openable = await helper.evaluate(`document.querySelectorAll('[data-qrp-open]').length`);
  check('popup offers Open only for the web links', openable === expectedOpenable, `${openable} of ${found.length} codes openable`);

  // innerText reflects text-transform, so the labels come back upper-cased.
  const text = await helper.evaluate(`document.getElementById('results').innerText`);
  check('blocked script payload is labelled and not openable', /not opened/i.test(text) && /blocked: javascript/i.test(text));
  check('lookalike domain shows its punycode form', /xn--/.test(text), (text.match(/xn--[a-z0-9-]+/) ?? [''])[0]);
  check('plain http link is called out as not secure', /not secure/i.test(text));
  check('code without a prefix explains that it opens over https', /left out the address prefix/.test(text));
  check('wifi code shows the network instead of a link', /Cafe Gruen/.test(text));
  check(
    'popup focuses the first Open button so Enter works',
    await helper.evaluate(`document.activeElement?.dataset?.qrpOpen === 'true'`),
  );
  check('popup shows the keyboard hint', /Enter opens/i.test(await helper.evaluate(`document.getElementById('hint').innerText`)));

  // The keyboard shortcut, driven through the handler itself rather than around it. Nothing can
  // fire chrome.commands, so the test build exposes what the listener calls.
  const clearOverlay = `(() => {
    document.getElementById('qr-peek-overlay')?.remove();
    document.querySelectorAll('[data-qrp-highlight]').forEach((node) => node.remove());
    return true;
  })()`;
  await page.evaluate(clearOverlay);
  await swEvaluate(`__qrpTestHooks.scanVisibleTab(${tabId})`);
  await sleep(600);

  const shownByShortcut = JSON.parse(
    (await page.evaluate(`document.getElementById('qr-peek-overlay')?.dataset.qrpTestHits ?? '[]'`)),
  );
  check(
    'the keyboard shortcut path captures, decodes and shows the panel',
    shownByShortcut.length === found.length,
    `${shownByShortcut.length} of ${found.length} codes`,
  );
  check(
    'it outlines every code it read',
    (await page.evaluate(`document.querySelectorAll('[data-qrp-highlight]').length`)) === shownByShortcut.length,
  );

  // The context menu, same treatment: the handler runs, not a stand-in for it.
  await page.evaluate(clearOverlay);
  await swEvaluate(`__qrpTestHooks.scanImage(${tabId}, '${siteUrl}qr-small.png')`);
  await sleep(800);
  const fromImage = JSON.parse(await page.evaluate(`document.getElementById('qr-peek-overlay')?.dataset.qrpTestHits ?? '[]'`));
  check('right-click on an image the page can read decodes that image', fromImage[0] === SMALL_CODE, JSON.stringify(fromImage));

  // An image from another origin taints the canvas, so the page cannot hand over its pixels and
  // the background has to crop the screenshot around it instead. This is the fallback branch.
  const crossOriginRead = await swEvaluate(`(async () => {
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content/overlay.js'] });
    return chrome.tabs.sendMessage(${tabId}, { type: 'QRP_READ_IMAGE', srcUrl: '${crossOriginUrl}' });
  })()`);
  check(
    'a cross-origin image really is unreadable to the page',
    !crossOriginRead.imageDataUrl && crossOriginRead.rect?.width === 150,
    JSON.stringify(crossOriginRead).slice(0, 80),
  );

  await page.evaluate(clearOverlay);
  await swEvaluate(`__qrpTestHooks.scanImage(${tabId}, '${crossOriginUrl}')`);
  await sleep(1200);
  const fromCrop = JSON.parse(await page.evaluate(`document.getElementById('qr-peek-overlay')?.dataset.qrpTestHits ?? '[]'`));
  check(
    'right-click falls back to cropping the screenshot for a cross-origin image',
    fromCrop[0] === CROSS_ORIGIN_CODE,
    JSON.stringify(fromCrop),
  );

  // The in-page overlay used by the shortcut and the context menu.
  await swEvaluate(`(async () => {
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content/overlay.js'] });
    return chrome.tabs.sendMessage(${tabId}, { type: 'QRP_SHOW', hits: [
      { text: '${CODES[0].text}', box: { x: 100, y: 120, width: 360, height: 360 } },
      { text: 'WIFI:T:WPA;S:Cafe;P:hunter2;;' },
    ] });
  })()`);
  check('overlay mounts a host element in the page', await page.evaluate(`!!document.getElementById('qr-peek-overlay')`));
  check(
    'overlay outlines the code it read, where it sits on the page',
    await page.evaluate(`document.querySelectorAll('[data-qrp-highlight]').length === 1`),
  );
  check(
    'overlay uses a closed shadow root, so page CSS cannot reach in',
    await page.evaluate(`document.getElementById('qr-peek-overlay').shadowRoot === null`),
  );

  // Right-click path: the page hands over the image's own pixels rather than a screenshot.
  const imageRead = await swEvaluate(`(async () => {
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content/overlay.js'] });
    return chrome.tabs.sendMessage(${tabId}, { type: 'QRP_READ_IMAGE', srcUrl: '${siteUrl}qr-small.png' });
  })()`);
  const decodedFromImage = imageRead.imageDataUrl ? await decodeDataUrl(imageRead.imageDataUrl) : [];
  check('right-click hands back the image itself, and it decodes', decodedFromImage[0] === SMALL_CODE, decodedFromImage.join(', '));
  check('right-click reports the element rect for the screenshot fallback', imageRead.rect?.width === 96, JSON.stringify(imageRead.rect));

  // Re-injection must not duplicate overlays or listeners.
  await swEvaluate(`(async () => {
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content/overlay.js'] });
    return chrome.tabs.sendMessage(${tabId}, { type: 'QRP_SHOW', hits: [{ text: 'https://example.com/second' }] });
  })()`);
  check('repeat injection leaves exactly one overlay', await page.evaluate(`document.querySelectorAll('#qr-peek-overlay').length === 1`));

  // A forged message must not turn into a navigation.
  const tabsBefore = await swEvaluate(`chrome.tabs.query({}).then(t => t.length)`);
  await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_OPEN_URL', url: 'javascript:alert(1)' }).catch(() => null)`);
  await sleep(800);
  const tabsAfter = await swEvaluate(`chrome.tabs.query({}).then(t => t.length)`);
  check('background refuses to open a forged javascript: payload', tabsBefore === tabsAfter, `${tabsBefore} -> ${tabsAfter} tabs`);

  await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_OPEN_URL', url: 'https://example.com/opened-ok' }).catch(() => null)`);
  await sleep(900);
  const openedUrls = await swEvaluate(`chrome.tabs.query({}).then(t => t.map(x => x.pendingUrl || x.url).join(' | '))`);
  check('background opens an https payload in a new tab', openedUrls.includes('https://example.com/opened-ok'));

  // A message the worker does not recognise is what a rebuilt-but-not-reloaded extension looks
  // like from a page. It has to come back with an explanation; silence reads as a dead worker.
  const unknown = await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_FROM_AN_OLDER_BUILD' })`);
  check(
    'an unrecognised message still gets an answer',
    typeof unknown?.error === 'string' && /reload/i.test(unknown.error),
    JSON.stringify(unknown)?.slice(0, 90),
  );

  // Opening a link is a round trip, so the caller can tell the difference between opened and lost.
  const opened = await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_OPEN_URL', url: 'https://example.com/round-trip' })`);
  check('opening a link is acknowledged', opened?.ok === true, JSON.stringify(opened));

  const refused = await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_OPEN_URL', url: 'javascript:alert(1)' })`);
  check(
    'a blocked payload comes back refused, not silently dropped',
    refused?.ok === false && /not a plain web link/.test(refused.error ?? ''),
    JSON.stringify(refused),
  );

  // Restricted pages must explain themselves rather than fail silently.
  const restricted = await helper.evaluate(`(async () => {
    const tab = await chrome.tabs.create({ url: 'chrome://version', active: true });
    await new Promise(r => setTimeout(r, 1200));
    const response = await chrome.runtime.sendMessage({ type: 'QRP_SCAN_ACTIVE_TAB' }).catch(e => ({ error: String(e) }));
    await chrome.tabs.remove(tab.id);
    return response;
  })()`);
  check('restricted page returns a clear explanation', /blocks extensions/i.test(restricted?.error ?? ''), (restricted?.error ?? 'no error').slice(0, 90));

  helper.close();
  page.close();
  sw.close();

  const failures = results.filter((passed) => !passed).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  return failures;
}
