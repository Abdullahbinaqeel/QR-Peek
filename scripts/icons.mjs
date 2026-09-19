import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

export async function buildIcons() {
  const svg = await readFile(resolve(root, 'assets/icon.svg'));
  const outDir = resolve(root, 'assets/icons');
  await mkdir(outDir, { recursive: true });

  await Promise.all(
    SIZES.map(async (size) => {
      const png = await sharp(svg).resize(size, size).png().toBuffer();
      await writeFile(resolve(outDir, `icon-${size}.png`), png);
    }),
  );
  return outDir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`icons written to ${await buildIcons()}`);
}
