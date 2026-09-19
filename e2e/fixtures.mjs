import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), 'site');

/** One code per risk class, so a single scan exercises the whole matrix. */
export const CODES = [
  { file: 'safe.png', text: 'https://example.com/scanned-by-extension?id=42', label: 'ordinary https link' },
  { file: 'insecure.png', text: 'http://neighbourhood.example/order', label: 'plain http' },
  { file: 'bare.png', text: 'example.org/table-12', label: 'no address prefix' },
  { file: 'script.png', text: 'javascript:alert(document.cookie)', label: 'script payload' },
  { file: 'lookalike.png', text: 'https://аpple.com/login', label: 'lookalike domain' },
  { file: 'wifi.png', text: 'WIFI:T:WPA;S:Cafe Gruen;P:hunter2;;', label: 'wifi network' },
];

export const SMALL_CODE = 'https://tiny.example.org/small';
/** Served from a second origin, so the page cannot read its pixels and the crop path is used. */
export const CROSS_ORIGIN_CODE = 'https://other.example.net/cross-origin';

export async function writeFixtures({ crossOriginBase = '' } = {}) {
  await mkdir(siteDir, { recursive: true });

  for (const code of CODES) {
    await QRCode.toFile(resolve(siteDir, code.file), code.text, { width: 180, margin: 2 });
  }
  await QRCode.toFile(resolve(siteDir, 'qr-small.png'), SMALL_CODE, { width: 96, margin: 2 });
  await QRCode.toFile(resolve(siteDir, 'qr-cross-origin.png'), CROSS_ORIGIN_CODE, { width: 150, margin: 2 });

  const cells = CODES.map(
    (code) => `      <figure><img src="${code.file}" width="180" height="180" alt="${code.label}"><figcaption>${code.label}</figcaption></figure>`,
  ).join('\n');

  await writeFile(
    resolve(siteDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>QR test page</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 28px; background: #fafafa; color: #16181d; }
      h1 { font-size: 17px; margin: 0 0 4px; }
      p { font-size: 13px; color: #616779; margin: 0 0 16px; }
      .grid { display: grid; grid-template-columns: repeat(3, 180px); gap: 18px 28px; }
      figure { margin: 0; }
      figcaption { font-size: 11px; color: #616779; margin-top: 4px; }
      #corner { position: fixed; right: 24px; bottom: 24px; }
      #cross-origin { position: fixed; left: 24px; bottom: 24px; }
    </style>
  </head>
  <body>
    <h1>QR test page</h1>
    <p>One code per risk class, plus a small one pinned in the corner.</p>
    <div class="grid">
${cells}
    </div>
    <img id="corner" src="qr-small.png" width="96" height="96" alt="small code in the corner">
    <img id="cross-origin" src="${crossOriginBase}/qr-cross-origin.png" width="150" height="150" alt="code served from another origin">
  </body>
</html>
`,
  );

  return siteDir;
}
