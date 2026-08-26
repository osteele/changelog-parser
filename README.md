# changelog-parser

Parse [Keep a Changelog](https://keepachangelog.com)-style Markdown and common
variants into JSON. Version headings use H2, category headings use H3, and
changes use ordered or unordered lists.

The synchronous API preserves multi-line list items, returns their contents as
HTML, Markdown, or plain text, and can reorder categories. Related parsers
include [changelog-parser](https://www.npmjs.com/package/changelog-parser) and
[parse-changelog](https://github.com/SamyPesse/parse-changelog).

```text
# Release Notes

## [1.0.0] - 2021-11-04

### Added

- Connect to turbo-encabulator on serial port

### Fixed

- Solar versus sidereal time in launch time calculation
- Inches versus millimeters in telescope mirror size
```

## Install

This package requires Node.js 20 or later.

```sh
bun add @osteele/changelog-parser
```

```sh
npm install @osteele/changelog-parser
```

```sh
yarn add @osteele/changelog-parser
```

## Usage

```js
import fs from "node:fs";
import parseChangeLog from "@osteele/changelog-parser";

const filePath = "/path/to/CHANGELOG.md";

// Parse a file directly.
const fromFile = parseChangeLog({ filePath });

// Or parse text that is already in memory.
const text = fs.readFileSync(filePath, "utf-8");
const fromText = parseChangeLog({ text });
```

For the changelog above, `fromText` has the following shape. The `body` value is
shortened here; it contains the rendered HTML for the complete version section.

```js
{
  title: "Release Notes",
  versions: [
    {
      title: "[1.0.0] - 2021-11-04",
      version: "1.0.0",
      date: "2021-11-04",
      body: "<h3>Added</h3>\n<ul>\n<li>Connect to turbo-encabulator…",
      changes: [
        { type: "Added", body: "Connect to turbo-encabulator on serial port" },
        { type: "Fixed", body: "Solar versus sidereal time in launch time calculation" },
        { type: "Fixed", body: "Inches versus millimeters in telescope mirror size" },
      ],
      categories: {
        Added: ["Connect to turbo-encabulator on serial port"],
        Fixed: [
          "Solar versus sidereal time in launch time calculation",
          "Inches versus millimeters in telescope mirror size",
        ],
      },
    },
  ],
}
```

See
[`./example/changelog2html.ts`](https://github.com/osteele/changelog-parser/blob/main/example/changelog2html.ts)
for an example.

See the [source
file](https://github.com/osteele/changelog-parser/blob/main/src/index.ts) or
the [TypeScript type declaration
file](https://unpkg.com/@osteele/changelog-parser@latest/dist/index.d.ts) for
the full types of the options, and the properties of the return value.

### Date formats

Version headings may use `YYYY-MM-DD`, `MM-DD-YYYY`, `MM-DD-YY`,
`MM/DD/YYYY`, or `MM/DD/YY`. Parsed dates are returned as `YYYY-MM-DD`.
Two-digit years from `00` through `60` map to 2000 through 2060; years from
`61` through `99` map to 1961 through 1999. Unrecognized date text after a
version separator is preserved as written.

### Options

You must provide either `filePath` or `text`. The remaining parameters are
optional.

#### text

Text of the change log.

#### filePath

Path to the change log. This is read synchronously and decoded as UTF-8.

#### categorySortOrder

If non-null, re-order change categories within each version.
Categories that are not in the configured order retain their source order after
the configured categories.

_Default_: `Added`, `New`, `Changed`, `Improved`, `Fixed`, `Removed`, then
`Security`.

Specify `null` to disable sorting.

#### defaultTitle

The default title. This is used if the source text doesn't have a title (H1
element, via `# Title` markdown notation).

_Default_: `"Release Notes"`

#### recognizeColonSections

If true, recognize e.g. `Changed:` as equivalent to `### Changed`.

_Default_: `true`

#### omitUnreleasedVersions

Omit versions whose titles are equal to "Unreleased", ignoring case.

_Default_: `true`

#### outputFormat

This controls the format of the `ChangeLog.changes[].body` and
`ChangeLog.categories[key]` strings.

Values:

- `html`: An HTML string, e.g. `"An item with <em>emphasis</em> and a <a
  href="target">link</a>."`
- `markdown`: The Markdown content of the list item, without its list marker,
  e.g. `"An item with *emphasis* and a [link](target)."`
- `text`: Text content, e.g. `"An item with emphasis and a link."`

_Default_: `html`

Each version's `body` is always HTML. HTML returned in `body` and, when
`outputFormat` is `html`, in `changes[].body` and `categories[key]` preserves raw
HTML from the source and is not sanitized. Untrusted input requires
sanitization before these strings are inserted into a web page.

## Development

Install the development dependencies and Git hooks, then run all project
checks:

```sh
bun install
bun run setup
bun run check
```

Run the repeatable parser audit—including contract tests, deterministic
generative tests, the curated mutation campaign, and package validation—with:

```sh
bun run audit
```

The coverage matrix, findings, and residual risks are recorded in
[`AUDIT.md`](./AUDIT.md).

## History

I wrote this package for the [Visual Studio Code P5 Server
Extension](https://github.com/osteele/vscode-p5server). I needed its release
notes parser to preserve links and multi-line list items. I discovered
`changelog-parser` while preparing this package for publication on npm.

## License

MIT
