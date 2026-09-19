# Contributing

Bug reports and pull requests are welcome.

## Getting set up

```sh
npm install
npm run build        # writes dist/chromium and dist/safari
npm test             # unit tests
npm run typecheck    # tsc --noEmit
```

Load `dist/chromium` through *Load unpacked* on `chrome://extensions` with Developer mode on.
After any code change, run `npm run build` and press the reload arrow on the extension card.

## Before opening a pull request

1. `npm run typecheck` and `npm test` pass.
2. `npm run test:e2e` passes. It drives a real browser, so it catches things unit tests cannot.
3. New behaviour comes with a test. A bug fix comes with a test that fails without the fix.

## What tends to get merged quickly

- Decoding failures with a reproducible image or page.
- A payload type that is classified wrongly, with the exact QR contents in the report.
- Warnings that are inaccurate or misleading. The wording matters here: it is what the user has
  to make a decision from, so it should be plain and specific.

## House style

- TypeScript, strict. `any` needs a comment explaining why.
- `async`/`await` rather than `.then` chains.
- Errors are handled or rethrown with context. No silent `catch`.
- Comments explain *why*, not what the line already says.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`.

## Things to be careful with

The rules in `src/lib/payload.ts` decide what the extension is willing to open. Loosening them is
a security change, not a convenience change, so expect the discussion to be about the threat
model rather than the code.
