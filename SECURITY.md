# Security policy

## Reporting a vulnerability

Please report security problems privately to the maintainer rather than in any public forum.

Include what you did, what happened, and the browser and version. A proof-of-concept page with
the QR code involved is the most useful thing you can attach.

This is a personal project, not a funded one, so there is no bounty, but you will be credited in
the release notes unless you would rather not be.

## What counts as a vulnerability here

The threat model is simple: **a QR code is untrusted input, and so is the page it sits on.**
Reports in these areas are especially welcome.

- A payload that reaches `tabs.create` despite not being `http` or `https`, for example through
  a parser difference between the classifier and the browser's own URL handling.
- A payload that renders as markup rather than text in the result card, in the popup or inside
  the injected panel.
- A page that can read, alter or trigger the injected panel, or forge a message that makes the
  background open a URL the user never saw.
- Anything that causes the extension to send page content off the machine. It should never make
  a network request of its own.

## Not vulnerabilities

- A link that is flagged as *Check first* and still opens after you click it. That is the design:
  QR Peek warns, you decide.
- A QR code that fails to decode. That is a bug, not a security issue.
- Findings that require the user to have already installed a malicious extension or to have
  developer tools attached.
