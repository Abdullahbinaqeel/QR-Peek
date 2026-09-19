# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Reopening the popup could report that the background did not respond, and refuse to rescan.
  The background now answers every message, including ones it does not recognise, which is what
  a page sees when an unpacked extension is rebuilt without being reloaded. Opening a link is
  acknowledged too, so the in-page card can tell an opened tab from a lost message, and messages
  retry briefly in case the one that wakes an idle worker is dropped.

### Testing

- The keyboard shortcut and the right-click menu are now covered end to end. Neither event can be
  fired programmatically, so a test build exposes what those listeners call and mirrors the
  panel's decoded text onto its host element; both are compiled out of a normal build, which the
  build script verifies by reading the shipped bundle back.
- The screenshot-crop fallback for an image the page cannot read is covered, using a second
  origin to make the image genuinely unreadable.
- A robustness suite pins what the decoder can and cannot read: blur, JPEG artifacts, washed-out
  contrast, noise, skew, occlusion, a logo through the middle, heavy downscaling, clipping and
  code size. Thresholds were measured by sweeping each kind of damage to failure, and the README
  quotes them.
- Micro QR and rMQR are now tested rather than merely declared.

## [0.1.0] - 2026-09-19

First working version.

### Added

- Scan the visible tab from the toolbar icon, from `⇧⌘Y` / `Ctrl+Shift+Y`, or by right-clicking
  an image.
- Result cards that classify each code as a web link, Wi-Fi network, contact card, calendar
  event, payment request, two-factor secret, email, phone, SMS, location or plain text.
- A risk model: plain links open on a click, questionable ones are flagged with the reason, and
  script, data, file and browser-internal schemes are never opened at all.
- Warnings for plain `http`, lookalike punycode domains, credentials before the `@`, bare IP
  hosts, non-standard ports and link shorteners.
- Codes that omit `https://` open over https, with the card saying that is what happened.
- The injected panel outlines each decoded code where it sits on the page.
- Keyboard handling: Enter opens the first link, Esc closes.
- Light and dark themes, following the browser.

### Notes

The decoder is ZXing through `zxing-wasm`. An earlier build used jsQR, which reports one code per
call and failed to find more than two codes on a page holding six; the regression tests for that
case are in `tests/decode.test.ts`.

