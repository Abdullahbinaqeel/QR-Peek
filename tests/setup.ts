import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareZXingModule as prepareWriter } from 'zxing-wasm/writer';
import { configureDecoder } from '../src/lib/decode';

// The extension resolves the decoder's wasm through runtime.getURL; under vitest there is no
// extension URL, so the bytes are handed over directly. The path is resolved from the project
// root rather than import.meta.url, which is not a file URL in the happy-dom environment.
const reader = await readFile(resolve(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
configureDecoder({ wasmBinary: reader.buffer as ArrayBuffer });

// The writer is a test-only tool for building fixtures the `qrcode` package cannot produce,
// such as Micro QR. The extension itself only ever imports the reader.
const writer = await readFile(resolve(process.cwd(), 'node_modules/zxing-wasm/dist/writer/zxing_writer.wasm'));
prepareWriter({ overrides: { wasmBinary: writer.buffer as ArrayBuffer }, fireImmediately: false });
