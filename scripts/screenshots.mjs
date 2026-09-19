// Regenerates the screenshots used by the README, from real scans in a real browser.
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import WebSocket from 'ws';
import { writeFixtures } from '../e2e/fixtures.mjs';

import { loadUnpacked } from '../e2e/load.mjs';

const out = resolve('docs/screenshots');
const CHROME = process.env.BROWSER_BINARY
  ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome-stable');
const PORT = 8766;
const CDP = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.png': 'image/png' };
try { execFileSync('pkill', ['-f', `remote-debugging-port=${CDP}`], { stdio: 'ignore' }); } catch {}

const siteDir = await writeFixtures();
const demoDir = resolve('docs/demo');
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path.startsWith('/demo/')
    ? join(demoDir, path.slice('/demo/'.length) || 'index.html')
    : join(siteDir, path === '/' ? 'index.html' : path);
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).on('error', () => res.writeHead(404).end()).pipe(res);
});
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));

const stage = await mkdtemp(join(tmpdir(), 'qrp-shots-'));
await cp(resolve('dist/chromium'), join(stage, 'ext'), { recursive: true });
const manifestPath = join(stage, 'ext', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(stage, 'profile')}`,
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=1280,860',
  `http://127.0.0.1:${PORT}/index.html`,
], { stdio: 'ignore' });

const base = `http://127.0.0.1:${CDP}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/json/version`)).ok) break; } catch {} await sleep(300); }
const extensionId = await loadUnpacked(base, join(stage, 'ext'));
await sleep(2000);

const list = async () => (await fetch(`${base}/json/list`)).json();
async function open(url) {
  const ws = new WebSocket(url, { maxPayload: 1 << 28 });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { resolve: res, reject: rej })); };
  return { send, evaluate: async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result.value, close: () => ws.close() };
}

const sw = await open((await list()).find((t) => t.url.endsWith('/background/index.js')).webSocketDebuggerUrl);
const page = await open((await list()).find((t) => t.type === 'page' && t.url.includes(String(PORT))).webSocketDebuggerUrl);
const tabId = await sw.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(t=>t[0].id)`);

async function shot(session, file, opts = {}) {
  const data = (await session.send('Page.captureScreenshot', { format: 'png', ...opts })).data;
  await writeFile(join(out, file), Buffer.from(data, 'base64'));
  console.log('wrote', file);
}

const helperUrl = `chrome-extension://${extensionId}/popup/index.html`;

/** Runs a genuine scan of the active tab through the background, the way the popup does. */
async function realScan() {
  const winId = await sw.evaluate(`chrome.windows.create({ url: '${helperUrl}', focused: false, width: 380, height: 640 }).then(w => w.id)`);
  await sleep(1200);
  const target = (await list()).find((t) => t.type === 'page' && t.url === helperUrl);
  const helper = await open(target.webSocketDebuggerUrl);
  await sw.evaluate(`(async () => {
    const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1:${PORT}/*' });
    await chrome.windows.update(t.windowId, { focused: true });
    await chrome.tabs.update(t.id, { active: true });
  })()`);
  await sleep(500);
  const response = await helper.evaluate(`chrome.runtime.sendMessage({ type: 'QRP_SCAN_ACTIVE_TAB' })`);
  helper.close();
  await sw.evaluate(`chrome.windows.remove(${winId})`);
  await sleep(400);
  return response.hits ?? [];
}

// The in-page panel over a realistic page, from a real scan so the outline is where the code is.
await page.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/demo/` });
await sleep(1200);
const demoHits = await realScan();
console.log('demo page scan:', demoHits.map((h) => h.text).join(', '), JSON.stringify(demoHits[0]?.box));
for (const scheme of ['light', 'dark']) {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await sleep(300);
  const hits = demoHits;
  await sw.evaluate(`(async () => {
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content/overlay.js'] });
    return chrome.tabs.sendMessage(${tabId}, { type: 'QRP_SHOW', hits: ${JSON.stringify(hits).replace(/`/g, '')} });
  })()`);
  await sleep(700);
  await shot(page, `in-page-${scheme}.png`);
}

// The popup, scanning the page that carries one code per risk class.
await page.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1500);
for (const scheme of ['light', 'dark']) {
  const winId = await sw.evaluate(`chrome.windows.create({ url: '${helperUrl}', focused: false, width: 380, height: 700 }).then(w => w.id)`);
  await sleep(1200);
  const target = (await list()).find((t) => t.type === 'page' && t.url === helperUrl);
  const popup = await open(target.webSocketDebuggerUrl);
  await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await sw.evaluate(`(async () => {
    const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1:${PORT}/index.html' });
    await chrome.windows.update(t.windowId, { focused: true });
    await chrome.tabs.update(t.id, { active: true });
  })()`);
  await sleep(500);
  await popup.evaluate(`document.getElementById('rescan').click()`);
  for (let i = 0; i < 40; i++) { if (await popup.evaluate(`document.querySelectorAll('.qrp-card').length > 0`)) break; await sleep(400); }
  await sleep(700);
  await popup.send('Emulation.setDeviceMetricsOverride', { width: 352, height: 592, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  await shot(popup, `popup-${scheme}.png`);
  popup.close();
  await sw.evaluate(`chrome.windows.remove(${winId})`);
}

sw.close(); page.close(); browser.kill(); server.close();
try { execFileSync('pkill', ['-f', `remote-debugging-port=${CDP}`], { stdio: 'ignore' }); } catch {}
process.exit(0);
