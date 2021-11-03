# changelog-parser

Parse ChangeLog files that are written in <https://keepachangelog.com> format.

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
    version?: string;
    title: string;
    date?: string;
    body: string;
    changes: { type: ChangeType; body: string }[];
    byType: Record<ChangeType, string[]>;
  }[];
};
```

where `changes` and `byType` each contain a list of the same changes, organized
differently.

See `example/changelog2html.ts` for an example.

## License

MIT
