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
npm install --save-dev changelog-parser
yarn add -D changelog-parser
```

## Usage

```js
import parseChangeLog from "../changelog";
const filePath = "/path/to/changelog.md"
const changelog = parseChangeLog({ filePath });
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
    changes: { type: ChangeType; body: string }[];
    byType: Record<ChangeType, string[]>;
  }[];
};
```

where `changes` and `byType` each contain a list of the same changes, organized
differently.

See `example/changelog2html.ts` for an example.

### Options

You must provide either `filePath` or `text`.

Other options:

#### defaultTitle: string

Default title the ChangeLog, if the source text doesn't have a title.

#### recognizeColonSections: boolean

If true, recognize e.g. `Changed:` as equivalent to `### Changed`.

#### changeCategoryOrder: string[] | null

If non-null, re-order change categories within each version.

#### omitUnreleasedVersions: boolean

Omit versions whose titles are equal to "Unreleased", ignoring case.

## License

MIT
