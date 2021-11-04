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
    changes: { type: CategoryName; body: string }[];
    categories: Record<CategoryName, string[]>;
  }[];
};

export type CategoryName =
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
    /** If non-null, re-order change categories within each version. */
    categorySortOrder: string[] | null;

    /** Default title, if the source text doesn't have one. */
    defaultTitle: string;

    /** If true, recognize e.g. `Changed:` as equivalent to `### Changed`. */
    recognizeColonSections: boolean;

    /** Omit versions whose titles are equal to "Unreleased", ignoring case. */
    omitUnreleasedVersions: boolean;
  }>;

const defaultOptions: Omit<Required<Options>, "text"> = {
  defaultTitle: "Release Notes",
  categorySortOrder: [
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
export function parseChangeLog(filepathOrOptions: string | Options): ChangeLog {
  const options = {
    filePath: undefined,
    text: undefined,
    ...defaultOptions,
    ...(typeof filepathOrOptions === "string"
      ? { filePath: filepathOrOptions }
      : filepathOrOptions),
  };
  let text = options.filePath
    ? fs.readFileSync(options.filePath, "utf-8")
    : options.text!;
  const { categorySortOrder: order } = options;

  if (options.recognizeColonSections) {
    text = text.replace(
      /^(Added|New|Changed|Improved|Fixed|Removed|Security):$/gim,
      "### $1"
    );
  }

  const html = marked(text, { headerIds: false, smartypants: true });
  const htmlRoot = parse(html);
  const title = htmlRoot.querySelector("h1")?.text || options.defaultTitle!;
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

      // collect and sort changes
      let changes = findSections("h3", parse(body)).flatMap(
        ({ header, body }): { type: CategoryName; body: string }[] => {
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

      // collect changes into categories
      const entries = changes.map(
        ({
          type,
          body,
        }: {
          type: CategoryName;
          body: string;
        }): [CategoryName, string] => [type, body]
      );
      const categories = collect(entries);

      return { title, version, date, body, changes, categories };
    }
  );
  if (options.omitUnreleasedVersions) {
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
