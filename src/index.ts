import marked from "marked";
import fs from "fs";
import { HTMLElement, parse } from "node-html-parser";
import { DateTime } from "luxon";

export type ChangeLog = {
  title: string;
  versions: {
    version: string | null;
    title: string;
    date: string | null;
    body: string;
    changes: { type: ChangeType; body: string }[];
    parsed: Record<ChangeType, string[]>;
  }[];
};

export type ChangeType =
  | "New"
  | "Changed"
  | "Improved"
  | "Fixed"
  | "Removed"
  | "Security"
  | string;

export type Options = (
  | {
      /** Text of the change log. Provide either this or `filePath`. */
      text: string;
    }
  | {
      /** Path to change log. This is read synchronously as UTF-8. */
      filePath: string;
    }
) &
  Partial<{
    /** Default title, if the source text doesn't have one. */
    defaultTitle: string;

    /** If true, recognize e.g. `Changed:` as equivalent to `### Changed`. */
    recognizeColonSections: boolean;

    /** If non-null, re-order change categories within each version. */
    changeCategoryOrder: string[] | null;

    /** Omit versions whose titles are equal to "Unreleased", ignoring case. */
    omitUnreleasedVersions: boolean;
  }>;

const defaultOptions: Omit<Required<Options>, "text"> = {
  defaultTitle: "Release Notes",
  changeCategoryOrder: [
    "New",
    "Changed",
    "Improved",
    "Fixed",
    "Removed",
    "Security",
  ],
  omitUnreleasedVersions: true,
  recognizeColonSections: true,
};

const dateFormats = [
  "yyyy-LL-dd",
  "LL-dd-yyyy",
  "LL-dd-yy",
  "LL/dd/yyyy",
  "LL/dd/yy",
];

/** Parse a change log. At least one of `text` and `filePath` must be provided.
 */
export function parseChangeLog(options: Options): ChangeLog {
  const defaultedOptions = {
    filePath: undefined,
    text: undefined,
    ...defaultOptions,
    ...options,
  };
  let text = defaultedOptions.filePath
    ? fs.readFileSync(defaultedOptions.filePath, "utf-8")
    : defaultedOptions.text!;
  const { changeCategoryOrder: order } = defaultedOptions;

  if (defaultedOptions.recognizeColonSections) {
    text = text.replace(
      /^(Added|New|Changed|Improved|Fixed|Removed|Security):$/gim,
      "### $1"
    );
  }

  const html = marked(text, { headerIds: false, smartypants: true });
  const htmlRoot = parse(html);
  const title =
    htmlRoot.querySelector("h1")?.text || defaultedOptions.defaultTitle!;
  const versionSectionTitles = findSections("h2", htmlRoot);
  let versions = versionSectionTitles.map(
    ({ header, body }): ChangeLog["versions"][0] => {
      const title = header.text.replace(/^\[(.*)\]$/, "$1");
      let versionCandidate = title,
        version: string | null = null,
        date: string | null = null;
      const m = title.match(/(.+?)(?:\s+-+\s+|\s*[–—]\s*)(.+)/);
      if (m) {
        versionCandidate = m[1];
        date =
          dateFormats
            .map((fmt) => DateTime.fromFormat(m[2], fmt))
            .find(Boolean)
            ?.toLocaleString(DateTime.DATE_FULL) || m[2];
      }
      versionCandidate =
        versionCandidate.match(/^\[(.+)\]$/)?.[1] || versionCandidate;
      if (versionCandidate.match(/^\d+(\.\d+){0,2}\S*$/))
        version = versionCandidate;
      let changes = findSections("h3", parse(body)).flatMap(
        ({ header, body }): { type: ChangeType; body: string }[] => {
          const type = header.text;
          const ul = parse(body).querySelector("ul");
          return ul
            ? ul
                .querySelectorAll("> li")
                .map((li) => ({ type, body: li.innerHTML }))
            : [];
        }
      );
      if (order) {
        changes = changes.sort(
          ({ type: k1 }, { type: k2 }) => order.indexOf(k1) - order.indexOf(k2)
        );
      }
      const entries = changes.map(
        ({
          type,
          body,
        }: {
          type: ChangeType;
          body: string;
        }): [ChangeType, string] => [type, body]
      );
      const parsed = collect(entries);
      return { title, version, date, body, changes, parsed };
    }
  );
  if (defaultedOptions.omitUnreleasedVersions) {
    versions = versions.filter(
      (version) => version.title && !/^unreleased$/i.test(version.title)
    );
  }

  return { title, versions };
}

function collect<K extends string | number | symbol, V>(
  pairs: [K, V][]
): Record<K, V[]> {
  const result: Record<K, V[]> = {} as Record<K, V[]>;
  for (const [key, value] of pairs) {
    if (!result[key]) result[key] = [];
    result[key].push(value);
  }
  return result;
}

function findSections(
  selector: string,
  parent: HTMLElement
): { header: HTMLElement; body: string }[] {
  const headers = parent.querySelectorAll(selector);
  return headers.map((header, i) => {
    const nextHeader = headers[i + 1];
    const body = [];
    for (
      let elt = header.nextElementSibling;
      elt && elt !== nextHeader;
      elt = elt.nextElementSibling
    ) {
      body.push(elt);
    }
    return {
      header,
      body: body.map((node) => node.outerHTML).join("\n"),
    };
  });
}
