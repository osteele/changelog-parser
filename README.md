# changelog-parser

Parse ChangeLog files that are written in the Markdown format suggested by [keep
a changelog](https://keepachangelog.com), e.g.:

```text
# Release Notes

## [1.0.0] - 11/04/21

### New

- Connect to turbo-encabulator on serial port

### Fixed

- Solar versus sideral time in launch time calculation
- Inches versus millimeters in telescope mirror size
```

## Install

```sh
npm install --save-dev @osteele/changelog-parser
```

```sh
yarn add -D @osteele/changelog-parser
```

## Usage

```js
import parseChangeLog from "@osteele/changelog-parser";

// either:
const filePath = "/path/to/changelog.md"
const changelog = parseChangeLog({ filePath });

// or:
const text = fs.readFileSync(filePath, 'utf-8');
const changelog = parseChangeLog({ text });

// => changelog:
{
  title: "Release Notes",
  versions: [
    {
      title: "[1.0.0] - 11/04/21",
      version: "1.0.0",
      date: "2021-11-04",
      changes: [
        {"New": "Connect to turbo-encabulator on serial port"},
        {"Fixed": "Solar versus sideral time in launch time calculation"},
        {"Fixed": "Inches versus millimeters in telescope mirror size"},
      ],
      categories: {
        "New": ["Connect to turbo-encabulator on serial port"],
        "Fixed": [
          "Solar versus sideral time in launch time calculation",
          "Inches versus millimeters in telescope mirror size"
        ]
      }
    }
  ]
}
```

See
[`./example/changelog2html.ts`](https://github.com/osteele/changelog-parser/blob/main/example/changelog2html.ts)
for an example.

See the [source
file](https://github.com/osteele/changelog-parser/blob/main/src/index.ts#L6) or
the [TypeScript type declaration
file](https://unpkg.com/@osteele/changelog-parser@latest/dist/index.d.ts) for
the full types of the options, and the properties of the return value.

### Options

You must provide either `filePath` or `text`. The remaining parameters are
optional.

#### text

Text of the change log.

#### filePath

Path to the change log. This is read synchronously and decoded as UTF-8.

#### categorySortOrder

If non-null, re-order change categories within each version.

See the
[source code](https://github.com/osteele/changelog-parser/blob/main/src/index.ts#L53)
for the default order.

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

## Comparison with other packages

This package provides similar functionality to the
[parse-changelogs](https://github.com/SamyPesse/parse-changelog) and
[changelog-parser](https://www.npmjs.com/package/changelog-parser) packages,
except that:

1. This packages recognizes multi-line text in change lists. (The other packages
   return only the first line.)
2. This packages returns HTML strings, instead of plaintext or markdown.
   (parse-changelogs returns only plaintext. changelog-parser can return either
   plaintext or markdown.)
3. Dates are in ISO format.
4. There are options to sort changes by category, to omit unreleased
   versions, and to recognize additional subheader formats.

If you want plaintext return values, you should one one of those packages. If you want
plaintext or markdown return values, you should use changelog-parser.

|                       | @osteele/changelog-parser | changelog-parser             | parse-changelogs |
| --------------------- | ------------------------- | ---------------------------- | ---------------- |
| Sync/async            | synchronous               | callback or Promise          | synchronous      |
| Text values           | html string               | markdown or plaintext string | plaintext string |
| Date format           | ISO                       | same as input                | ISO              |
| Multi-line list items | ✔️                         | x                            | x                |

## License

MIT
