# Privacy policy

QR Peek collects nothing.

## What the extension does with your data

- **Screenshots of the visible tab** are taken only when you ask for a scan, by clicking the
  toolbar icon, pressing the keyboard shortcut, or using the right-click menu. The image is
  decoded in memory, in your browser, and discarded when the scan finishes. It is never written
  to disk and never leaves your machine.
- **Decoded results** are shown to you and then dropped. There is no scan history, no database
  and no synced storage.
- **The `storage` permission** is used for exactly one thing: keeping the text of the last error
  message so the popup can explain a failed scan. It holds no page content and no scan results.

## What is not collected

No analytics. No telemetry. No crash reporting. No advertising identifiers. No account. Nothing
is sent to any server operated by the author or anyone else.

## Network activity

The extension makes no network requests of its own. The decoder's WebAssembly binary is bundled
inside the extension rather than fetched from a CDN, so scanning works offline.

The only navigation QR Peek can cause is opening a link you explicitly click **Open in new tab** on,
and only when that link uses `http` or `https`.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `activeTab` | Take one screenshot of the tab you are on, granted per action by your click, shortcut or menu choice |
| `scripting` | Inject the result card into the page for the shortcut and right-click paths |
| `contextMenus` | Add the *Scan QR code in this image* entry |
| `storage` | Remember the last error string, nothing else |

There are no host permissions, so the extension cannot read pages you have not pointed it at.

## Contact

Questions about this policy go to the maintainer of the copy of QR Peek you are using.
