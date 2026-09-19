// Zips a build for upload to a browser's extension store.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] ?? 'chromium';
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

const source = resolve(root, 'dist', target);
const outDir = resolve(root, 'dist', 'packages');
const archive = resolve(outDir, `qr-peek-${target}-${version}.zip`);

await mkdir(outDir, { recursive: true });
await rm(archive, { force: true });

// -r recurse, -q quiet, -X drop macOS resource forks the stores reject.
execFileSync('zip', ['-rqX', archive, '.'], { cwd: source, stdio: 'inherit' });
console.log(`packaged ${archive.replace(`${root}/`, '')}`);
