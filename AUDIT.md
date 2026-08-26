# Audit History

This file records shared source-code audit outcomes. Detailed campaign state and
review telemetry are intentionally not stored in the repository.

## 2026-08-13 — Unreleased working copy

Scope: The documented parser API, Markdown structure and rendering, options and
exported types, dates and versions, category collection and sorting, package
entry points, malformed-input recovery, and bounded resource behavior.

Evidence: Contract and example tests cover supported input channels, output
formats, option states, heading forms, line endings, opaque Markdown regions,
inline HTML boundaries, lists, tables, dates, versions, and prototype-property
category names. Deterministic model-based and malformed-input campaigns exercise
valid and invalid input families. The curated semantic mutation campaign runs
passing baselines and distinguishes assertion kills, survivors, invalid mutants,
and timeouts. Package checks build and smoke-test ESM and CommonJS entry points.
Bounded regressions cover large changelogs, alternating opaque ranges, and
unterminated HTML-like input.

Resolved:

- Colon-style categories now work without blank lines and remain isolated from
  fenced code, block quotes, raw HTML blocks, code spans, comments, CDATA,
  processing instructions, and code-like inline HTML regions.
- Colon recognition respects Markdown block boundaries, escaped syntax, HTML
  attributes, link and image titles, matching raw-tag closers, and blank-line
  termination. Its avoidable repeated range scans and heading re-lexing were
  removed.
- Malformed inline HTML recovery avoids repeated suffix scans while preserving
  later emphasis, links, code, hard breaks, and GFM URL and email autolinks.
- Text output omits inline comments without applying smart punctuation to code;
  nested lists and tables render consistently across output formats.
- Date validation handles four-digit years below 100, version recognition
  rejects more than three numeric components, and category lookup is
  prototype-safe and accurately typed as possibly absent.
- Package entry points are smoke-tested, and the declared Node.js floor matches
  runtime dependency requirements.
- The curated mutation runner verifies an unmodified baseline, supports focused
  replay, and reports behavioral, timeout, survivor, and invalid outcomes
  separately.

Remaining gaps: General-operator mutation remains deferred. Generated campaigns
still need direct single-seed replay, feature counters, shrinking, and a retained
minimal corpus. The configured Node release matrix has not been observed in this
local audit. Broader denial-of-service testing, stable-host performance budgets,
and complete clause-level documentation traceability remain pending. Raw HTML in
HTML output remains deliberately unsanitized and must be sanitized by consumers
that process untrusted input.
