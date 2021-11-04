# changelog-parser

Parse ChangeLog files that are written in <https://keepachangelog.com> format.

This package provides similar functionality to the
[parse-changelogs](https://github.com/SamyPesse/parse-changelog) and
[changelog-parser](https://www.npmjs.com/package/changelog-parser) packages,
except that:

1. It recognizes multi-line items in the change lists.
2. It returns HTML instead of plaintext or markdown.
3. Dates are in ISO format.
4. There are options to sort changes by category, and to omit unreleased
   versions.

If you want plaintext, you should one one of those packages. If you want
plaintext or markdown, you should use changelog-parser.

## Install

```sh
npm install --save-dev @osteele/changelog-parser
```

```sh
yarn add -D @osteele/changelog-parser
```

## Usage

```js
import parseChangeLog from "../changelog";
const filePath = "/path/to/changelog.md"
const changelog = parseChangeLog({ filePath });

// or:
const text = fs.readFileSync(filePath, 'utf-8');
const changelog = parseChangeLog({ text });

// =>
{
  title: "Release notes",
  versions: [
    {
      title: "[1.0.0] - 11/04/21",
      version: "1.0.0",
      date: "2021-11-04",
      changes: [
        {"New": "Connect to turboencabulator if present on serial port"},
        {"Fixed": "Confused solar and sideral time in launch calculations"},
        {"Fixed": "Confused inches and millimeters in mirror size"},
      ],
      categories: {
        "New": ["Connect to turboencabulator if present on serial port"],
        "Fixed": [
          "Confused solar and sideral time in launch calculations",
          "Confused inches and millimeters in mirror size"
        ]
      }
    }
  ]
}
```

The return value has this type:

```js
export type ChangeLog = {
  title: string;
  versions: {
    version: string | null;
    title: string;
    date: string | null;
    body: string;
    changes: { type: CategoryName; body: string }[];
    categories: Record<CategoryName, string[]>;
  }[];
};
```

where `changes` and `categories` each contain a list of the same changes,
organized as a list of Object (`changes`) or as an Object map of category names
to lists (`categories`).

See `example/changelog2html.ts` for an example.

See the [source
file](https://github.com/osteele/changelog-parser/blob/main/src/index.ts#L6)
[type file](https://unpkg.com/@osteele/changelog-parser@latest/dist/index.d.ts)
for the full types of the options and return value.

### Options

You must provide either `filePath` or `text`. The remaining parameters are
optional.

#### text

Text of the change log.

#### filePath

Path to the change log. This is read synchronously as UTF-8.

#### categorySortOrder

If non-null, re-order change categories within each version.

See the
[source](https://github.com/osteele/changelog-parser/blob/main/src/index.ts#L53)
for the default order. Specify null to disable sorting.

#### defaultTitle

Default title, if the source text doesn't have a title. (Default: "Release
Notes".)

#### recognizeColonSections

If true, recognize e.g. `Changed:` as equivalent to `### Changed`. (Default:
true.)

#### omitUnreleasedVersions

Omit versions whose titles are equal to "Unreleased", ignoring case. (Default:
true.)

## License

MIT
