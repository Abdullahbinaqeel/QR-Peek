import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { buildIcons } from './icons.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/**
 * A test build exposes the background's orchestration so the browser suite can drive the exact
 * code paths behind the keyboard shortcut and the context menu, neither of which can be
 * triggered through any API. In a normal build the flag is false and esbuild drops the block,
 * which `assertNoTestHooks` below confirms rather than assumes.
 */
const testBuild = process.argv.includes('--test');

/** Chromium covers Chrome, Brave and Edge; Safari differs only in its manifest. */
const TARGETS = testBuild ? ['test'] : ['chromium', 'safari'];

/** The test target is a chromium build with the hooks compiled in. */
const manifestFor = (target) => (target === 'test' ? 'chromium' : target);

const ENTRIES = {
  'background/index.js': 'src/background/index.ts',
  'popup/popup.js': 'src/popup/popup.ts',
  'content/overlay.js': 'src/content/overlay.ts',
};

async function bundle(target) {
  const outDir = resolve(root, 'dist', target);

  const options = {
    bundle: true,
    // IIFE, not ESM: content scripts injected via scripting.executeScript are classic scripts,
    // and a classic service worker is the safest common denominator across Chromium and Safari.
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'safari16.4'],
    define: { __QRP_TEST__: String(testBuild) },
    minify: !dev && !testBuild,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
  };

  const contexts = await Promise.all(
    Object.entries(ENTRIES).map(([out, entry]) =>
      esbuild.context({ ...options, entryPoints: [resolve(root, entry)], outfile: resolve(outDir, out) }),
    ),
  );

  if (watch) {
    await Promise.all(contexts.map((context) => context.watch()));
  } else {
    await Promise.all(contexts.map(async (context) => {
      await context.rebuild();
      await context.dispose();
    }));
  }
}

async function copyStatic(target) {
  const outDir = resolve(root, 'dist', target);
  await mkdir(resolve(outDir, 'popup'), { recursive: true });
  await cp(resolve(root, `src/manifest.${manifestFor(target)}.json`), resolve(outDir, 'manifest.json'));
  await cp(resolve(root, 'src/popup/index.html'), resolve(outDir, 'popup/index.html'));
  await cp(resolve(root, 'src/popup/popup.css'), resolve(outDir, 'popup/popup.css'));
  await cp(resolve(root, 'assets/icons'), resolve(outDir, 'icons'), { recursive: true });
  // The decoder's WebAssembly binary ships with the extension so nothing is fetched at runtime.
  await cp(
    resolve(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'),
    resolve(outDir, 'zxing_reader.wasm'),
  );
}

/** A shipped build must not carry the test hooks. Check the bytes, do not trust the flag. */
async function assertNoTestHooks(outDir) {
  const source = await readFile(resolve(outDir, 'background/index.js'), 'utf8');
  if (source.includes('__qrpTestHooks')) {
    throw new Error(`${outDir} contains test hooks; it must never be shipped`);
  }
}

await buildIcons();

for (const target of TARGETS) {
  if (!watch) await rm(resolve(root, 'dist', target), { recursive: true, force: true });
  await copyStatic(target);
  await bundle(target);
  if (target !== 'test' && !watch) await assertNoTestHooks(resolve(root, 'dist', target));
  const files = await readdir(resolve(root, 'dist', target));
  console.log(`dist/${target}: ${files.sort().join(', ')}`);
}

if (watch) console.log('watching for changes…');
