import marked from "marked";
import fs from "fs";
import { HTMLElement, parse } from "node-html-parser";
import { DateTime } from "luxon";

export type ChangeLog = {
  title: string;
  versions: {
    version?: string;
    title: string;
    date?: string;
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

export type Options = Partial<{
  defaultTitle: string;
  recognizeColonSections: boolean;
  order: string[] | null;
}> &
  ({ text: string } | { filePath: string });

const defaultOptions: Omit<Required<Options>, "text"> = {
  defaultTitle: "Release Notes",
  recognizeColonSections: true,
  order: ["New", "Changed", "Improved", "Fixed", "Removed", "Security"],
};

const dateFormats = [
  "yyyy-LL-dd",
  "LL-dd-yyyy",
  "LL-dd-yy",
  "LL/dd/yyyy",
  "LL/dd/yy",
];
export function parseChangeLog(options: Options): ChangeLog {
  const opts = {
    filePath: undefined,
    text: undefined,
    ...defaultOptions,
    ...options,
  };
  let text = opts.filePath
    ? fs.readFileSync(opts.filePath, "utf-8")
    : opts.text!;
  const { order } = opts;

  if (opts.recognizeColonSections) {
    text = text.replace(
      /^(Added|New|Changed|Improved|Fixed|Removed|Security):$/gm,
      "### $1"
    );
  }

  const html = marked(text, { headerIds: false, smartypants: true });
  const htmlRoot = parse(html);
  const title = htmlRoot.querySelector("h1")?.text || options.defaultTitle!;
  const sections = findSections("h2", htmlRoot);
  const data = {
    title,
    versions: sections.map(({ header, body }) => {
      const title = header.text.replace(/^\[(.*)\]$/, "$1");
      let versionCandidate = title,
        version: string | undefined,
        date: string | undefined;
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
    }),
  };

  return data;
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
