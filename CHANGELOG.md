# Change Log

## [Unreleased]

## [1.0.0] - 2026-08-14

### Added

- Add Markdown as a supported output format.
- Add contract tests, deterministic generative and malformed-input tests, a
  curated mutation campaign, and a persistent audit ledger.
- Test the published ESM and CommonJS entry points in continuous integration on
  supported Node.js release lines.
- Run the CI matrix on Ubuntu and Windows across Node.js 20.19, 22, 24, and 26.
- Add a differential Markdown-container matrix for raw delimiter ownership.
- Type-check tests and the example alongside the published source.

### Changed

- Parse the Marked token stream directly and remove the HTML DOM parser
  dependency.
- Collect changes from every top-level list in a category, including ordered
  lists.
- Sort unknown categories after configured categories while preserving their
  source order, and add `Added` to the default category order.
- Stop date parsing after the first valid format. Parsing ISO dates is 4.3×
  faster in the date-specific benchmark.
- Parse the rendered HTML into a DOM once, filter omitted versions before
  extracting their changes, and use indexed category ranks. In the included
  Node benchmark on an ARM64 Mac, the cumulative changes were 1.21× faster for
  the 5.3 KB fixture and 1.84× faster for a 105 KB input.
- Replace Luxon with a small validated parser for the five supported date
  formats, removing a 3.6 MB installed dependency.
- Recognize colon-style category sections without requiring blank lines while
  leaving fenced code, block quotes, and raw HTML blocks unchanged.
- Type category lookup results as possibly absent.

### Fixed

- Parse every documented non-ISO date format instead of returning
  `Invalid DateTime`.
- Preserve inline and block code punctuation in text output, and omit inline
  HTML comments.
- Keep colon-style category recognition out of inline `style` and `textarea`
  regions without treating escaped tags as HTML.
- Keep unmatched inline Markdown delimiters isolated to their source blocks
  during colon-style category recognition.
- Avoid quadratic colon-section recognition across many opaque Markdown ranges.
- Avoid repeatedly scanning the same suffix for unterminated HTML while
  preserving later Markdown constructs and GFM autolinks.
- Align the declared Node.js requirement with the runtime dependencies.
- Preserve complete comments and CDATA across nested lists, block quotes, lazy
  continuations, and tab-expanded indentation.
- Keep malformed delimiters isolated from later Markdown blocks and unrelated
  container boundaries.
- Protect raw HTML and literal-element contents from delimiter preprocessing and
  Smartypants rewriting.
- Normalize four-digit years from 0000 through 0099 correctly.
- Reject version candidates with more than three numeric components.

## [0.0.4] - 2021-11-04

Fixed:

- Set output format to CJS

## [0.0.3] - 2021-11-04

Fixed:

- Add dist directory to distro

## [0.0.2] - 2021-11-04

Fixed:

- Distribute type file.

## [0.0.1] - 2021-11-04

Initial release
