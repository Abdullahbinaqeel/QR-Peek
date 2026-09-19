import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks } from './checks.mjs';
import { writeFixtures } from './fixtures.mjs';
import { loadUnpacked } from './load.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const BROWSERS = process.platform === 'darwin'
  ? {
      chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    }
  : {
      chrome: 'google-chrome-stable',
      brave: 'brave-browser',
      edge: 'microsoft-edge-stable',
    };

const name = (process.argv.find((arg) => arg.startsWith('--browser='))?.split('=')[1] ?? 'chrome').toLowerCase();
const binary = process.env.BROWSER_BINARY ?? BROWSERS[name];
if (!binary) throw new Error(`Unknown browser "${name}". Use chrome, brave or edge, or set BROWSER_BINARY.`);

const PORT = 8765;
/** A second origin for the same files, so a page-unreadable image can be exercised. */
const CROSS_ORIGIN_PORT = 8764;
const CDP_PORT = 9333;
const MIME = { '.html': 'text/html', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };

/** A browser left behind by an interrupted run keeps the port and serves a deleted build. */
function killStaleBrowser(port) {
  try {
    execFileSync('pkill', ['-f', `remote-debugging-port=${port}`], { stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched, which is the normal case.
  }
}

const cleanup = [];
const finish = async (code) => {
  for (const task of cleanup.reverse()) await task().catch(() => {});
  process.exit(code);
};

try {
  killStaleBrowser(CDP_PORT);
  const crossOriginBase = `http://127.0.0.1:${CROSS_ORIGIN_PORT}`;
  const siteDir = await writeFixtures({ crossOriginBase });

  const serve = (port) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://x').pathname;
      const file = join(siteDir, path === '/' ? 'index.html' : path);
      response.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
      // Deliberately no CORS headers: the cross-origin image must stay unreadable to the page.
      createReadStream(file).on('error', () => response.writeHead(404).end()).pipe(response);
    });
    cleanup.push(() => new Promise((done) => server.close(done)));
    return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
  };

  await serve(PORT);
  await serve(CROSS_ORIGIN_PORT);

  // A test-only copy of the build: driving the extension over CDP cannot produce the real
  // user click that grants activeTab, so the copy takes a blanket host permission instead.
  const stage = await mkdtemp(join(tmpdir(), 'qrp-e2e-'));
  cleanup.push(() => rm(stage, { recursive: true, force: true }));
  // A test build: same code, plus hooks that reach the handlers behind the keyboard shortcut
  // and the context menu, neither of which any API can fire.
  execFileSync('node', [resolve(root, 'scripts/build.mjs'), '--test'], { cwd: root, stdio: 'inherit' });
  await cp(resolve(root, 'dist/test'), join(stage, 'ext'), { recursive: true });
  const manifestPath = join(stage, 'ext', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // CI runners have no usable sandbox and a small /dev/shm, and Chrome simply fails to start
  // without saying so on stdout, which looks like a port timeout further down.
  const sandboxFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];

  const browser = spawn(binary, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(stage, 'profile')}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    ...sandboxFlags,
    `http://127.0.0.1:${PORT}/index.html`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Keep the browser's own complaints so a start-up failure reports itself.
  let browserStderr = '';
  browser.stderr.on('data', (chunk) => {
    browserStderr = (browserStderr + chunk.toString()).slice(-2000);
  });
  browser.on('error', (error) => {
    browserStderr += `\nspawn failed: ${error.message}`;
  });
  cleanup.push(async () => {
    // The staging directory is removed next, so the browser has to be gone first.
    browser.kill();
    for (let attempt = 0; attempt < 40 && browser.exitCode === null; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
    }
    killStaleBrowser(CDP_PORT);
  });

  const cdpBase = `http://127.0.0.1:${CDP_PORT}`;
  await waitFor(
    async () => (await fetch(`${cdpBase}/json/version`)).ok,
    'the browser to expose its debugging port',
    20000,
    () => browserStderr,
  );

  const extensionId = await loadUnpacked(cdpBase, join(stage, 'ext'));
  console.log(`${name}: loaded extension ${extensionId}\n`);

  const failures = await runChecks({
    cdpBase,
    extensionId,
    siteUrl: `http://127.0.0.1:${PORT}/`,
    crossOriginUrl: `${crossOriginBase}/qr-cross-origin.png`,
  });
  await finish(failures === 0 ? 0 : 1);
} catch (error) {
  console.error(error);
  await finish(1);
}

async function waitFor(condition, label, timeoutMs = 20000, diagnostics = () => '') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch {
      // not ready yet
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  const detail = diagnostics();
  throw new Error(`Timed out waiting for ${label}${detail ? `\n\nBrowser output:\n${detail}` : ''}`);
}
