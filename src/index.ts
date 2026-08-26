import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { decodeHTML, encodeHTML } from "entities";
import {
  Marked,
  type MarkedExtension,
  type Token,
  type Tokens,
  type TokensList,
} from "marked";
import { markedSmartypants } from "marked-smartypants";

const unterminatedHTMLExtension: MarkedExtension = {
  extensions: [
    {
      name: "unterminatedHtml",
      level: "inline",
      start(value) {
        const index = value.indexOf("<");
        return index === -1 ? undefined : index;
      },
      tokenizer(value) {
        if (value[0] !== "<") return undefined;
        const tagScan = findHTMLTagEnd(value, 0);
        if (!tagScan.unterminated) return undefined;
        const recoveryEnd = findMalformedHTMLRecoveryEnd(value);
        const raw = value.slice(0, recoveryEnd);
        return {
          type: "text",
          raw,
          text: escapeMalformedHTML(raw),
          escaped: true,
        };
      },
    },
  ],
  renderer: {
    html({ text }) {
      const escaped = escapeUnterminatedDelimitedHTML(text);
      return escaped === text ? false : escaped;
    },
  },
};

const markdownParser = new Marked(
  unterminatedHTMLExtension,
  markedSmartypants(),
);

function escapeMalformedHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeMalformedDelimiters(value: string): string {
  return value
    .replaceAll("<!--", "&lt;!--")
    .replaceAll("<![CDATA[", "&lt;![CDATA[");
}

type SourceMarkers = {
  comment: string;
  cdata: string;
  rawElementOpen: string;
  rawElementClose: string;
  rawElements: string[];
};
type PreparedMarkdown = { value: string; markers: SourceMarkers | null };
type PendingDelimiter = {
  index: number;
  blockStart: boolean;
  containerPath: MarkdownContainer[] | null;
};
type MarkdownContainer =
  | { kind: "quote" }
  | { kind: "bullet"; continuationIndent: number }
  | { kind: "ordered"; start: number; continuationIndent: number };
type MarkdownContainerPrefix = {
  cursor: number;
  listDepth: number;
  quoteDepth: number;
  containers: MarkdownContainer[];
};

function createSourceMarkers(
  value: string,
): Omit<SourceMarkers, "rawElements"> {
  const characters = new Set(value);
  const markers: string[] = [];
  for (let codePoint = 0xe000; codePoint <= 0xf8ff; codePoint += 1) {
    const marker = String.fromCharCode(codePoint);
    if (!characters.has(marker)) markers.push(marker);
    if (markers.length === 4) {
      return {
        comment: markers[0],
        cdata: markers[1],
        rawElementOpen: markers[2],
        rawElementClose: markers[3],
      };
    }
  }
  let prefix: string;
  do {
    prefix = `\0changelog-parser-source-${randomUUID().replaceAll("-", "")}:`;
  } while (value.includes(prefix));
  return {
    comment: `${prefix}comment\0`,
    cdata: `${prefix}cdata\0`,
    rawElementOpen: `${prefix}raw:`,
    rawElementClose: "\0",
  };
}

function prepareMarkdown(value: string): PreparedMarkdown {
  const htmlTagRanges = collectCompleteHTMLTagRanges(value);
  let htmlTagRangeIndex = 0;
  const malformedOpeners = new Set<number>();
  const pendingOpeners: Partial<Record<"comment" | "cdata", PendingDelimiter>> =
    {};
  const boundaries = collectMarkdownBoundaries(value);
  let boundaryIndex = 0;
  const delimiterPattern = /<!--|-->|<!\[CDATA\[|\]\]>/g;
  for (const match of value.matchAll(delimiterPattern)) {
    const index = match.index;
    while (boundaries[boundaryIndex]?.index <= index) {
      for (const kind of ["comment", "cdata"] as const) {
        const pending = pendingOpeners[kind];
        if (
          pending &&
          (!pending.blockStart ||
            !delimiterLineBelongsToContainer(
              value,
              boundaries[boundaryIndex].index,
              pending,
            ))
        ) {
          malformedOpeners.add(pending.index);
          delete pendingOpeners[kind];
        }
      }
      boundaryIndex += 1;
    }
    while (htmlTagRanges[htmlTagRangeIndex]?.[1] <= index) {
      htmlTagRangeIndex += 1;
    }
    const htmlTagRange = htmlTagRanges[htmlTagRangeIndex];
    if (htmlTagRange && htmlTagRange[0] <= index) {
      if (htmlTagRange[0] === index) {
        const kind = value.startsWith("<!--", index) ? "comment" : "cdata";
        const pending = pendingOpeners[kind];
        if (pending !== undefined) {
          malformedOpeners.add(pending.index);
          delete pendingOpeners[kind];
        }
      }
      continue;
    }
    const delimiter = match[0];
    const kind =
      delimiter === "<!--" || delimiter === "-->" ? "comment" : "cdata";
    const isOpener = delimiter === "<!--" || delimiter === "<![CDATA[";
    if (isOpener && !isEscaped(value, index)) {
      const pending = pendingOpeners[kind];
      if (pending !== undefined) malformedOpeners.add(pending.index);
      pendingOpeners[kind] = {
        index,
        ...getDelimiterBlockContext(value, index),
      };
    } else if (!isOpener) {
      const pending = pendingOpeners[kind];
      if (
        pending &&
        !delimiterCloserBelongsToContainer(value, index, pending)
      ) {
        malformedOpeners.add(pending.index);
      }
      delete pendingOpeners[kind];
    }
  }
  for (const pending of Object.values(pendingOpeners)) {
    if (pending !== undefined) malformedOpeners.add(pending.index);
  }
  const rawElementRanges = collectCompleteInlineLiteralElementRanges(value);
  if (malformedOpeners.size === 0 && rawElementRanges.length === 0) {
    return { value, markers: null };
  }
  const markers: SourceMarkers = {
    ...createSourceMarkers(value),
    rawElements: [],
  };
  let rawElementIndex = 0;
  let prepared = "";
  for (let index = 0; index < value.length; ) {
    const rawRange = rawElementRanges[rawElementIndex];
    if (rawRange?.[0] === index) {
      const source = value.slice(rawRange[0], rawRange[1]);
      const markerIndex = markers.rawElements.length;
      markers.rawElements.push(source);
      prepared += `${markers.rawElementOpen}${markerIndex}${markers.rawElementClose}`;
      index = rawRange[1];
      rawElementIndex += 1;
      continue;
    }
    if (malformedOpeners.has(index)) {
      const isComment = value.startsWith("<!--", index);
      prepared += isComment ? markers.comment : markers.cdata;
      index += isComment ? 4 : 9;
      continue;
    }
    prepared += value[index];
    index += 1;
  }
  return { value: prepared, markers };
}

function collectMarkdownBoundaries(value: string): { index: number }[] {
  const boundaries: { index: number }[] = [];
  let offset = 0;
  let previousQuoteDepth = 0;
  let afterBlankLine = false;
  for (const line of value.split(/(?<=\n)|(?<=\r)(?!\n)/)) {
    const source = line.replace(/[\r\n]+$/, "");
    const containerPrefix = scanMarkdownContainerPrefix(source);
    const { cursor, listDepth, quoteDepth } = containerPrefix;
    const content = source.slice(cursor);
    const blank = content.trim().length === 0 && listDepth === 0;
    if (!blank && offset > 0) {
      const startsListItem =
        listDepth > 0 &&
        isContainerPrefixAtBlockStart(value, offset, containerPrefix);
      const startsBlock = startsMarkdownBlock(content);
      const hard =
        startsListItem || startsBlock || quoteDepth !== previousQuoteDepth;
      if (hard || afterBlankLine) boundaries.push({ index: offset });
    }
    if (!blank) previousQuoteDepth = quoteDepth;
    afterBlankLine = blank;
    offset += line.length;
  }
  return boundaries;
}

function startsMarkdownBlock(value: string): boolean {
  return /^(?:#{1,6}(?:[ \t]+|$)|`{3,}|~{3,}|<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)|<(?:script|pre|style|text(?:area))(?:[ \t>]|$)|<\?|<![A-Z]|<!\[CDATA\[|<\/)|^(?:[ ]{0,3})(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    value,
  );
}

function scanMarkdownContainerPrefix(value: string): MarkdownContainerPrefix {
  let cursor = 0;
  let listDepth = 0;
  let quoteDepth = 0;
  const containers: MarkdownContainer[] = [];
  let pendingIndentation = "";
  for (;;) {
    const indentation = /^ {0,3}/.exec(value.slice(cursor))?.[0] ?? "";
    cursor += indentation.length;
    pendingIndentation += indentation;
    if (value[cursor] === ">") {
      quoteDepth += 1;
      containers.push({ kind: "quote" });
      pendingIndentation = "";
      cursor += 1;
      if (value[cursor] === " " || value[cursor] === "\t") {
        pendingIndentation = value[cursor];
        cursor += 1;
      }
      continue;
    }
    const listMarker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(
      value.slice(cursor),
    );
    if (listMarker) {
      listDepth += 1;
      const orderedStart = /^(\d{1,9})[.)]/.exec(listMarker[0]);
      const continuationIndent = orderedStart
        ? Math.min(
            5,
            countMarkdownColumns(`${pendingIndentation}${listMarker[0]}`),
          )
        : countMarkdownColumns(`${pendingIndentation}${listMarker[0]}`);
      containers.push(
        orderedStart
          ? {
              kind: "ordered",
              start: Number(orderedStart[1]),
              continuationIndent,
            }
          : { kind: "bullet", continuationIndent },
      );
      pendingIndentation = "";
      cursor += listMarker[0].length;
      continue;
    }
    return {
      cursor,
      listDepth,
      quoteDepth,
      containers,
    };
  }
}

function countMarkdownColumns(value: string, initialColumn = 0): number {
  let column = initialColumn;
  for (const character of value) {
    column = character === "\t" ? column + (4 - (column % 4)) : column + 1;
  }
  return column - initialColumn;
}

function isContainerPrefixAtBlockStart(
  value: string,
  lineStart: number,
  prefix: MarkdownContainerPrefix,
): boolean {
  const nonInterruptingListIndex = prefix.containers.findIndex(
    (container) => container.kind === "ordered" && container.start !== 1,
  );
  if (nonInterruptingListIndex === -1 || lineStart === 0) return true;

  const previousLineEnd = lineStart - 1;
  const previousLineStart = Math.max(
    value.lastIndexOf("\n", previousLineEnd - 1) + 1,
    0,
  );
  const previousLine = value
    .slice(previousLineStart, previousLineEnd)
    .replace(/\r$/, "");
  if (previousLine.trim().length === 0) return true;

  const previousPrefix = scanMarkdownContainerPrefix(previousLine);
  if (previousPrefix.listDepth > 0) return true;
  const earlierContainers = prefix.containers.slice(
    0,
    nonInterruptingListIndex,
  );
  if (
    earlierContainers.some(
      (container) =>
        container.kind === "bullet" ||
        (container.kind === "ordered" && container.start === 1),
    )
  ) {
    return true;
  }
  const earlierQuoteDepth = earlierContainers.filter(
    (container) => container.kind === "quote",
  ).length;
  if (earlierQuoteDepth > previousPrefix.quoteDepth) return true;

  return startsMarkdownBlock(previousLine.slice(previousPrefix.cursor));
}

function getDelimiterBlockContext(
  value: string,
  index: number,
): Pick<PendingDelimiter, "blockStart" | "containerPath"> {
  const lineStart = Math.max(value.lastIndexOf("\n", index - 1) + 1, 0);
  const prefix = value.slice(lineStart, index);
  const containerPrefix = scanMarkdownContainerPrefix(prefix);
  const blockStart =
    containerPrefix.cursor === prefix.length &&
    isContainerPrefixAtBlockStart(value, lineStart, containerPrefix);
  return {
    blockStart,
    containerPath:
      blockStart && containerPrefix.containers.length > 0
        ? containerPrefix.containers
        : null,
  };
}

function delimiterLineBelongsToContainer(
  value: string,
  index: number,
  pending: PendingDelimiter,
): boolean {
  if (pending.containerPath === null) return true;
  const lineStart = Math.max(value.lastIndexOf("\n", index - 1) + 1, 0);
  const openingLineStart = Math.max(
    value.lastIndexOf("\n", pending.index - 1) + 1,
    0,
  );
  if (lineStart === openingLineStart) return true;
  const lineEnd = value.indexOf("\n", lineStart);
  const prefixEnd =
    index === lineStart ? (lineEnd === -1 ? value.length : lineEnd) : index;
  return lineMatchesContainerPath(
    value.slice(lineStart, prefixEnd).replace(/\r$/, ""),
    pending.containerPath,
  );
}

function delimiterCloserBelongsToContainer(
  value: string,
  index: number,
  pending: PendingDelimiter,
): boolean {
  if (pending.containerPath?.every((container) => container.kind !== "quote")) {
    return true;
  }
  return delimiterLineBelongsToContainer(value, index, pending);
}

function lineMatchesContainerPath(
  value: string,
  containers: MarkdownContainer[],
): boolean {
  let cursor = 0;
  let column = 0;
  let requiredIndent = 0;
  let sawQuote = false;
  for (const container of containers) {
    if (container.kind !== "quote") {
      requiredIndent += container.continuationIndent;
      continue;
    }
    const whitespaceStartColumn = column;
    while (value[cursor] === " " || value[cursor] === "\t") {
      column += countMarkdownColumns(value[cursor], column);
      cursor += 1;
    }
    const indentation = column - whitespaceStartColumn;
    if (
      indentation < requiredIndent ||
      (requiredIndent === 0 && indentation > 3) ||
      value[cursor] !== ">"
    ) {
      return false;
    }
    sawQuote = true;
    cursor += 1;
    column += 1;
    requiredIndent = 0;
  }
  const whitespaceStartColumn = column;
  const whitespaceStart = cursor;
  while (value[cursor] === " " || value[cursor] === "\t") {
    column += countMarkdownColumns(value[cursor], column);
    cursor += 1;
  }
  const indentation = column - whitespaceStartColumn;
  const continuationWhitespace = value.slice(whitespaceStart, cursor);
  const hasTab = continuationWhitespace.includes("\t");
  const listDepth = containers.filter(
    (container) => container.kind !== "quote",
  ).length;
  const tabContinuation = /^\t+ *$/.test(continuationWhitespace)
    ? continuationWhitespace.replace(/ +$/, "").length >=
        Math.max(2, listDepth) ||
      (continuationWhitespace.startsWith("\t  ") && listDepth === 1)
    : /^\t {2,}$/.test(continuationWhitespace)
      ? requiredIndent <= 3
      : continuationWhitespace.includes(" \t") &&
        (column >= requiredIndent || requiredIndent <= 5);
  if (
    sawQuote &&
    (value[cursor] === ">" ||
      (startsMarkdownBlock(value.slice(cursor)) &&
        requiredIndent > 0 &&
        (hasTab ? !tabContinuation : indentation < requiredIndent)) ||
      /^(?:[*+-](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))/.test(
        value.slice(cursor),
      ))
  ) {
    return false;
  }
  if (sawQuote) return true;
  return column - whitespaceStartColumn >= requiredIndent;
}

function collectCompleteHTMLTagRanges(value: string): [number, number][] {
  const ranges: [number, number][] = [];
  const delimitedRanges = new Map(
    collectCompleteDelimitedHTMLRanges(value).map((range) => [range[0], range]),
  );
  const literalTagsWithoutCloser = new Set<string>();
  let index = value.indexOf("<");
  while (index !== -1) {
    if (
      value.startsWith("<!--", index) ||
      value.startsWith("<![CDATA[", index)
    ) {
      const delimitedRange = delimitedRanges.get(index);
      if (delimitedRange) {
        const rangeEnd = delimitedRange[1];
        ranges.push(delimitedRange);
        index = value.indexOf("<", rangeEnd);
      } else {
        index = value.indexOf("<", index + 1);
      }
      continue;
    }
    const tagScan = findHTMLTagEnd(value, index);
    if (tagScan.end === null) {
      index = value.indexOf("<", index + 1);
    } else {
      let rangeEnd = tagScan.end + 1;
      const tag = value.slice(index, rangeEnd);
      const tagName = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(tag)?.[1];
      const normalizedTagName = tagName?.toLowerCase();
      if (
        tagName &&
        normalizedTagName &&
        new RegExp(`^(?:${colonOpaqueHTMLTagNames})$`, "i").test(tagName) &&
        !literalTagsWithoutCloser.has(normalizedTagName) &&
        !/\/>$/.test(tag)
      ) {
        const closingPattern = new RegExp(`</${tagName}\\s*>`, "gi");
        closingPattern.lastIndex = rangeEnd;
        const closing = closingPattern.exec(value);
        if (closing) {
          rangeEnd = closing.index + closing[0].length;
        } else {
          literalTagsWithoutCloser.add(normalizedTagName);
        }
      }
      ranges.push([index, rangeEnd]);
      index = value.indexOf("<", rangeEnd);
    }
  }
  return ranges;
}

function collectCompleteDelimitedHTMLRanges(value: string): [number, number][] {
  const markedRanges =
    /\t|^>.*(?:[-+*]|\d+[.)])/m.test(value) &&
    !(value.includes("<!--") && value.includes("<![CDATA["))
      ? collectMarkedDelimitedHTMLRanges(value)
      : [];
  const markedStarts = new Set(markedRanges.map(([start]) => start));
  const openerStarts = new Set(
    [...value.matchAll(/<!--|<!\[CDATA\[/g)].map((match) => match.index),
  );
  const ranges: [number, number][] = [];
  const pending: Partial<Record<"comment" | "cdata", PendingDelimiter>> = {};
  const boundaries = collectMarkdownBoundaries(value);
  let boundaryIndex = 0;
  for (const match of value.matchAll(/<!--|-->|<!\[CDATA\[|\]\]>/g)) {
    while (boundaries[boundaryIndex]?.index <= match.index) {
      for (const kind of ["comment", "cdata"] as const) {
        const openerState = pending[kind];
        if (
          openerState &&
          (!openerState.blockStart ||
            !delimiterLineBelongsToContainer(
              value,
              boundaries[boundaryIndex].index,
              openerState,
            ))
        ) {
          delete pending[kind];
        }
      }
      boundaryIndex += 1;
    }
    const delimiter = match[0];
    const kind =
      delimiter === "<!--" || delimiter === "-->" ? "comment" : "cdata";
    const opener = delimiter === "<!--" || delimiter === "<![CDATA[";
    if (opener) {
      if (!isEscaped(value, match.index)) {
        pending[kind] = {
          index: match.index,
          ...getDelimiterBlockContext(value, match.index),
        };
      }
      continue;
    }
    const openerState = pending[kind];
    if (
      openerState !== undefined &&
      delimiterCloserBelongsToContainer(value, match.index, openerState)
    ) {
      ranges.push([openerState.index, match.index + delimiter.length]);
    }
    delete pending[kind];
  }
  if (markedRanges.length === 0) return ranges;
  return [
    ...markedRanges,
    ...ranges.filter(
      ([start]) => markedStarts.has(start) || !openerStarts.has(start),
    ),
  ].sort((left, right) => left[0] - right[0]);
}

function collectMarkedDelimitedHTMLRanges(value: string): [number, number][] {
  const ranges: [number, number][] = [];
  let searchFrom = 0;
  const visit = (tokens: readonly Token[] | undefined): void => {
    for (const token of tokens ?? []) {
      if (token.type === "html" && /^<!--|^<!\[CDATA\[/.test(token.raw)) {
        const opener = token.raw.startsWith("<!--") ? "<!--" : "<![CDATA[";
        const closer = opener === "<!--" ? "-->" : "]]>";
        const start = value.indexOf(opener, searchFrom);
        const end = value.indexOf(closer, start + opener.length);
        if (start !== -1 && end !== -1 && token.raw.includes(closer)) {
          ranges.push([start, end + closer.length]);
          searchFrom = end + closer.length;
        }
      }
      if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens);
      if (token.type === "list") {
        for (const item of token.items) visit(item.tokens);
      }
    }
  };
  visit(markdownParser.lexer(value));
  return ranges;
}

function collectCompleteInlineLiteralElementRanges(
  value: string,
): [number, number][] {
  if (!/<(?:code|kbd|math)(?=[\s>])/i.test(value)) return [];
  const ranges: [number, number][] = [];
  const boundaries = [
    0,
    ...collectMarkdownBoundaries(value).map(({ index }) => index),
    value.length,
  ];
  for (
    let boundaryIndex = 0;
    boundaryIndex < boundaries.length - 1;
    boundaryIndex += 1
  ) {
    const blockStart = boundaries[boundaryIndex];
    const blockEnd = boundaries[boundaryIndex + 1];
    const block = value.slice(blockStart, blockEnd);
    if (
      !/<(?:code|kbd|math)(?=[\s>])/i.test(block) ||
      !/<\/(?:code|kbd|math)\s*>/i.test(block)
    ) {
      continue;
    }
    const opaqueRanges = [
      ...collectCompleteDelimitedHTMLRanges(block),
      ...collectInlineCodeSpanRanges(block),
      ...collectLinkDestinationRanges(block),
    ].sort((left, right) => left[0] - right[0]);
    let opaqueRangeIndex = 0;
    const pending: Record<"code" | "kbd" | "math", number[]> = {
      code: [],
      kbd: [],
      math: [],
    };
    let index = block.indexOf("<");
    while (index !== -1) {
      while (opaqueRanges[opaqueRangeIndex]?.[1] <= index) {
        opaqueRangeIndex += 1;
      }
      const opaqueRange = opaqueRanges[opaqueRangeIndex];
      if (opaqueRange && opaqueRange[0] <= index) {
        index = block.indexOf("<", opaqueRange[1]);
        continue;
      }
      if (isEscaped(block, index)) {
        index = block.indexOf("<", index + 1);
        continue;
      }
      const tagEnd = findHTMLTagEnd(block, index).end;
      if (tagEnd === null) {
        index = block.indexOf("<", index + 1);
        continue;
      }
      const tag = block.slice(index, tagEnd + 1);
      const opening = /^<(code|kbd|math)(?=[\s>])/i
        .exec(tag)?.[1]
        ?.toLowerCase() as "code" | "kbd" | "math" | undefined;
      if (opening && !/\/\s*>$/.test(tag)) pending[opening].push(index);
      const closing = /^<\/(code|kbd|math)\s*>/i
        .exec(tag)?.[1]
        ?.toLowerCase() as "code" | "kbd" | "math" | undefined;
      if (closing) {
        const openingIndex = pending[closing].pop();
        if (openingIndex !== undefined) {
          ranges.push([blockStart + openingIndex, blockStart + tagEnd + 1]);
        }
      }
      index = block.indexOf("<", tagEnd + 1);
    }
  }
  return mergeOverlappingRanges(ranges);
}

function mergeOverlappingRanges(
  ranges: [number, number][],
): [number, number][] {
  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] < previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function collectInlineCodeSpanRanges(value: string): [number, number][] {
  const runs: { start: number; end: number; length: number }[] = [];
  let index = value.indexOf("`");
  while (index !== -1) {
    let end = index + 1;
    while (value[end] === "`") end += 1;
    if (!isEscaped(value, index)) {
      runs.push({ start: index, end, length: end - index });
    }
    index = value.indexOf("`", end);
  }

  const nextRunWithLength = new Array<number | undefined>(runs.length);
  const nextByLength = new Map<number, number>();
  for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
    const run = runs[runIndex];
    nextRunWithLength[runIndex] = nextByLength.get(run.length);
    nextByLength.set(run.length, runIndex);
  }

  const ranges: [number, number][] = [];
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const closingIndex = nextRunWithLength[runIndex];
    if (closingIndex !== undefined) {
      ranges.push([runs[runIndex].start, runs[closingIndex].end]);
      runIndex = closingIndex;
    }
  }
  return ranges;
}

function collectLinkDestinationRanges(value: string): [number, number][] {
  const ranges: [number, number][] = [];
  const codeRanges = collectInlineCodeSpanRanges(value);
  const lastClosingParenthesis = findLastUnescapedCharacter(value, ")");
  let codeRangeIndex = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    while (codeRanges[codeRangeIndex]?.[1] <= index) codeRangeIndex += 1;
    const codeRange = codeRanges[codeRangeIndex];
    if (codeRange && codeRange[0] <= index) {
      index = codeRange[1] - 1;
      continue;
    }
    if (isEscaped(value, index)) continue;
    if (value[index] === "[") {
      bracketDepth += 1;
      continue;
    }
    if (value[index] !== "]" || bracketDepth === 0) continue;
    bracketDepth -= 1;
    if (value[index + 1] !== "(") continue;
    if (index + 1 > lastClosingParenthesis) break;
    const end = findLinkDestinationEnd(value, index + 1);
    if (end !== null) {
      ranges.push([index + 1, end]);
      index = end - 1;
    }
  }
  return ranges;
}

function findLastUnescapedCharacter(value: string, character: string): number {
  let last = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
    } else if (value[index] === character) {
      last = index;
    }
  }
  return last;
}

function findLinkDestinationEnd(value: string, start: number): number | null {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (value[index] === quote) quote = null;
      continue;
    }
    if (value[index] === '"' || value[index] === "'") {
      quote = value[index] as '"' | "'";
    } else if (value[index] === "(") {
      depth += 1;
    } else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function restoreMalformedDelimiters(
  value: string,
  markers: SourceMarkers | null,
  format: "html" | "markdown" | "text",
): string {
  if (markers === null) return value;
  const comment = format === "html" ? "&lt;!--" : "<!--";
  const cdata = format === "html" ? "&lt;![CDATA[" : "<![CDATA[";
  const restored = restoreRawElementMarkers(value, markers, (source) =>
    format === "text" ? decodeHTML(stripHTMLLiteralElement(source)) : source,
  );
  return restored
    .replaceAll(markers.comment, comment)
    .replaceAll(markers.cdata, cdata);
}

function restoreRawElementMarkers(
  value: string,
  markers: SourceMarkers,
  restore: (source: string) => string,
): string {
  let result = "";
  let offset = 0;
  for (;;) {
    const start = value.indexOf(markers.rawElementOpen, offset);
    if (start === -1) return result + value.slice(offset);
    const markerStart = start + markers.rawElementOpen.length;
    const end = value.indexOf(markers.rawElementClose, markerStart);
    if (end === -1) return result + value.slice(offset);
    const markerIndex = Number(value.slice(markerStart, end));
    const source = markers.rawElements[markerIndex];
    const markerEnd = end + markers.rawElementClose.length;
    if (source === undefined || !Number.isSafeInteger(markerIndex)) {
      result += value.slice(offset, markerEnd);
    } else {
      result += value.slice(offset, start) + restore(source);
    }
    offset = markerEnd;
  }
}

function stripHTMLLiteralElement(value: string): string {
  const openingEnd = findHTMLTagEnd(value, 0).end;
  const closing = /<\/(?:code|kbd|math)\s*>$/i.exec(value);
  if (openingEnd === null || closing === null) return stripHTML(value);
  const content = value.slice(openingEnd + 1, closing.index);
  const prepared = prepareMarkdown(content);
  let stripped = markdownParser.Lexer.lexInline(
    prepared.value,
    markdownParser.defaults,
  )
    .map((token) => (token.type === "html" ? stripHTML(token.raw) : token.raw))
    .join("");
  if (prepared.markers === null) return stripped;
  stripped = restoreRawElementMarkers(
    stripped,
    prepared.markers,
    stripHTMLLiteralElement,
  );
  return stripped
    .replaceAll(prepared.markers.comment, "<!--")
    .replaceAll(prepared.markers.cdata, "<![CDATA[");
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function escapeUnterminatedDelimitedHTML(value: string): string {
  if (value.startsWith("<!--") && !value.includes("-->", 4)) {
    return `&lt;${value.slice(1)}`;
  }
  if (value.startsWith("<![CDATA[") && !value.includes("]]>", 9)) {
    return `&lt;${value.slice(1)}`;
  }
  return value;
}

export type ChangeLog = {
  title: string;
  versions: {
    version: string | null;
    title: string;
    date: string | null;
    body: string;
    changes: { type: CategoryName; body: string }[];
    categories: Partial<Record<CategoryName, string[]>>;
  }[];
};

type Change = ChangeLog["versions"][number]["changes"][number];

type Section = {
  header: Tokens.Heading;
  body: Token[];
};

export type CategoryName =
  | "Added"
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

    /**
     * The format of ChangeLog.changes[].body and ChangeLog.categories[key].
     * HTML output preserves raw HTML and is not sanitized.
     */
    outputFormat: "html" | "markdown" | "text";
  }>;

const defaultOptions: Omit<Required<Options>, "text"> = {
  defaultTitle: "Release Notes",
  categorySortOrder: [
    "Added",
    "New",
    "Changed",
    "Improved",
    "Fixed",
    "Removed",
    "Security",
  ],
  omitUnreleasedVersions: true,
  outputFormat: "html",
  recognizeColonSections: true,
};

const colonSectionPattern =
  /^(Added|New|Changed|Improved|Fixed|Removed|Security):(?=\r?$)/gim;
const smartypantsLiteralHTMLTagNames = "pre|code|kbd|script|math";
const colonOpaqueHTMLTagNames = `${smartypantsLiteralHTMLTagNames}|style|textarea`;

/** Parse a change log. At least one of `text` and `filePath` must be provided.
 */
export function parseChangeLog(filepathOrOptions: string | Options): ChangeLog {
  const inputOptions =
    typeof filepathOrOptions === "string"
      ? { filePath: filepathOrOptions }
      : filepathOrOptions;
  const options = {
    filePath: "filePath" in inputOptions ? inputOptions.filePath : undefined,
    text: "text" in inputOptions ? inputOptions.text : undefined,
    categorySortOrder: resolveOption(
      inputOptions.categorySortOrder,
      defaultOptions.categorySortOrder,
    ),
    defaultTitle: resolveOption(
      inputOptions.defaultTitle,
      defaultOptions.defaultTitle,
    ),
    recognizeColonSections: resolveOption(
      inputOptions.recognizeColonSections,
      defaultOptions.recognizeColonSections,
    ),
    omitUnreleasedVersions: resolveOption(
      inputOptions.omitUnreleasedVersions,
      defaultOptions.omitUnreleasedVersions,
    ),
    outputFormat: resolveOption(
      inputOptions.outputFormat,
      defaultOptions.outputFormat,
    ),
  };
  let text: string;
  if (options.filePath !== undefined) {
    text = fs.readFileSync(options.filePath, "utf-8");
  } else if (options.text !== undefined) {
    text = options.text;
  } else {
    throw new TypeError("Expected either text or filePath");
  }
  const categoryRanks = createCategoryRanks(options.categorySortOrder);

  const prepared = prepareMarkdown(text);
  const tokens = markdownParser.lexer(prepared.value);
  if (options.recognizeColonSections) recognizeColonSections(tokens);
  const titleHeader = tokens.find((token) => isHeading(token, 1));
  const title = titleHeader
    ? restoreMalformedDelimiters(
        renderInlineText(titleHeader.tokens),
        prepared.markers,
        "text",
      )
    : options.defaultTitle;
  let versionSections = findSections(2, tokens);
  if (options.omitUnreleasedVersions) {
    versionSections = versionSections.filter(
      ({ header }) =>
        !/^unreleased$/i.test(
          restoreMalformedDelimiters(
            getSectionTitle(header),
            prepared.markers,
            "text",
          ),
        ),
    );
  }
  const versions = versionSections.map(
    ({ header, body }): ChangeLog["versions"][0] => {
      const title = restoreMalformedDelimiters(
        getSectionTitle(header),
        prepared.markers,
        "text",
      );
      let versionCandidate = title,
        version: string | null = null,
        date: string | null = null;
      const m = title.match(/(.+?)(?:\s+-+\s+|\s*[–—]\s*)(.+)/);
      if (m) {
        versionCandidate = m[1];
        date = parseDate(m[2]) ?? m[2];
      }
      versionCandidate =
        versionCandidate.match(/^\[(.+)\]$/)?.[1] || versionCandidate;
      if (versionCandidate.match(/^\d+(?:\.\d+){0,2}(?:[^.\s]\S*)?$/))
        version = versionCandidate;

      // collect and sort changes
      const changes = findSections(3, body).flatMap(
        ({ header, body }): { type: CategoryName; body: string }[] => {
          const type = restoreMalformedDelimiters(
            renderInlineText(header.tokens),
            prepared.markers,
            "text",
          );
          return body.filter(isList).flatMap(({ items }) =>
            items.map((item) => ({
              type,
              body: restoreMalformedDelimiters(
                renderChangeBody(item, options.outputFormat),
                prepared.markers,
                options.outputFormat,
              ),
            })),
          );
        },
      );
      if (categoryRanks) {
        const unknownRank = categoryRanks.size;
        changes.sort(
          ({ type: k1 }, { type: k2 }) =>
            (categoryRanks.get(k1) ?? unknownRank) -
            (categoryRanks.get(k2) ?? unknownRank),
        );
      }

      const categories = collectCategories(changes);

      return {
        title,
        version,
        date,
        body: restoreMalformedDelimiters(
          renderHTML(body),
          prepared.markers,
          "html",
        ),
        changes,
        categories,
      };
    },
  );

  return { title, versions };
}

export default parseChangeLog;

function collectCategories(
  changes: readonly Change[],
): Partial<Record<CategoryName, string[]>> {
  const categories: Partial<Record<CategoryName, string[]>> = {};
  for (const { type, body } of changes) {
    const existing = Object.hasOwn(categories, type)
      ? categories[type]
      : undefined;
    const category = existing ?? [];
    if (existing === undefined) {
      Object.defineProperty(categories, type, {
        configurable: true,
        enumerable: true,
        value: category,
        writable: true,
      });
    }
    category.push(body);
  }
  return categories;
}

function resolveOption<T>(value: T | undefined, defaultValue: T): T {
  return value === undefined ? defaultValue : value;
}

function recognizeColonSections(tokens: TokensList): void {
  for (let index = 0; index < tokens.length; ) {
    if (isColonRewriteOpaqueToken(tokens[index])) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < tokens.length && !isColonRewriteOpaqueToken(tokens[end])) {
      end += 1;
    }
    const sourceBlocks = tokens.slice(index, end);
    const replacements = tokenizeColonSections(sourceBlocks, tokens.links);
    if (replacements === null) {
      index = end;
      continue;
    }
    tokens.splice(index, end - index, ...replacements);
    index += replacements.length;
  }
}

function isColonRewriteOpaqueToken(token: Token): boolean {
  return (
    token.type === "blockquote" ||
    token.type === "code" ||
    token.type === "html"
  );
}

function tokenizeColonSections(
  sourceBlocks: readonly Token[],
  links: TokensList["links"],
): Token[] | null {
  const value = sourceBlocks.map(({ raw }) => raw).join("");
  const opaqueRanges = findInlineOpaqueRanges(sourceBlocks);
  let opaqueRangeIndex = 0;
  const replacements: Token[] = [];
  let cursor = 0;
  let changed = false;
  colonSectionPattern.lastIndex = 0;
  for (const match of value.matchAll(colonSectionPattern)) {
    const offset = match.index;
    while (
      opaqueRanges[opaqueRangeIndex]?.[1] !== undefined &&
      opaqueRanges[opaqueRangeIndex][1] <= offset
    ) {
      opaqueRangeIndex += 1;
    }
    const range = opaqueRanges[opaqueRangeIndex];
    if (range && range[0] <= offset) continue;

    changed = true;
    replacements.push(
      ...lexMarkdownFragment(value.slice(cursor, offset), links),
    );
    let end = offset + match[0].length;
    if (value.startsWith("\r\n", end)) end += 2;
    else if (value[end] === "\n") end += 1;
    const category = match[1];
    replacements.push({
      type: "heading",
      raw: value.slice(offset, end),
      depth: 3,
      text: category,
      tokens: markdownParser.Lexer.lexInline(category, markdownParser.defaults),
    });
    cursor = end;
  }
  if (!changed) return null;
  replacements.push(...lexMarkdownFragment(value.slice(cursor), links));
  return replacements;
}

function lexMarkdownFragment(
  value: string,
  links: TokensList["links"],
): Token[] {
  if (value.length === 0) return [];
  const lexer = new markdownParser.Lexer(markdownParser.defaults);
  lexer.tokens.links = links;
  return lexer.lex(value);
}

function findInlineOpaqueRanges(
  sourceBlocks: readonly Token[],
): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  let literalRange: { start: number; tagName: string } | null = null;
  for (const sourceBlock of sourceBlocks) {
    const blockStart = offset;
    if (sourceBlock.type === "space" && literalRange) {
      ranges.push([literalRange.start, blockStart]);
      literalRange = null;
    }
    const tokens = getInlineTokens(sourceBlock);
    for (const token of tokens) {
      const start = offset;
      const end = start + token.raw.length;
      offset = end;
      if (literalRange) {
        if (token.type === "html") {
          const closingEnd = findClosingTagEnd(token.raw, literalRange.tagName);
          if (closingEnd !== null) {
            ranges.push([literalRange.start, start + closingEnd]);
            literalRange = null;
          }
        }
        continue;
      }
      if (token.type === "html") {
        const tagName = getOpeningColonOpaqueTag(token.raw);
        if (tagName !== null) {
          literalRange = { start, tagName };
        } else {
          ranges.push([start, end]);
        }
      } else if (token.type !== "text") {
        ranges.push([start, end]);
      }
    }
    offset = blockStart + sourceBlock.raw.length;
  }
  if (literalRange) ranges.push([literalRange.start, offset]);
  return ranges;
}

function getInlineTokens(token: Token): Token[] {
  if (
    (token.type === "paragraph" || token.type === "heading") &&
    hasTokens(token)
  ) {
    return token.tokens;
  }
  if (token.type === "space") return [];
  return markdownParser.Lexer.lexInline(token.raw, markdownParser.defaults);
}

function getOpeningColonOpaqueTag(value: string): string | null {
  const match = /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/.exec(value);
  if (
    !match ||
    !new RegExp(`^(?:${colonOpaqueHTMLTagNames})$`, "i").test(match[1])
  ) {
    return null;
  }
  const tagScan = findHTMLTagEnd(value, 0);
  return tagScan.end !== null && value[tagScan.end - 1] !== "/"
    ? match[1]
    : null;
}

function findClosingTagEnd(value: string, tagName: string): number | null {
  const match = new RegExp(`^</${tagName}\\s*>`, "i").exec(value);
  return match ? match[0].length : null;
}

function createCategoryRanks(
  order: readonly string[] | null,
): Map<string, number> | null {
  if (!order) {
    return null;
  }
  const ranks = new Map<string, number>();
  for (const category of order) {
    if (!ranks.has(category)) {
      ranks.set(category, ranks.size);
    }
  }
  return ranks;
}

function isHeading(token: Token, depth: number): token is Tokens.Heading {
  return token.type === "heading" && token.depth === depth;
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

function findSections(depth: number, tokens: readonly Token[]): Section[] {
  const sections: Section[] = [];
  for (const token of tokens) {
    if (isHeading(token, depth)) {
      sections.push({ header: token, body: [] });
    } else {
      sections.at(-1)?.body.push(token);
    }
  }
  return sections;
}

function getSectionTitle(header: Tokens.Heading): string {
  return renderInlineText(header.tokens).replace(/^\[(.*)\]$/, "$1");
}

function renderChangeBody(
  item: Tokens.ListItem,
  format: "html" | "markdown" | "text",
): string {
  switch (format) {
    case "html":
      return renderHTML(item.tokens);
    case "markdown": {
      const body = item.text.trim();
      return item.task ? `[${item.checked ? "x" : " "}] ${body}` : body;
    }
    case "text":
      return renderText(item.tokens).trim();
  }
}

function renderHTML(tokens: readonly Token[]): string {
  return postprocess(markdownParser.parser([...tokens]));
}

function renderInlineText(tokens: readonly Token[]): string {
  const source = renderInlineSource(tokens);
  return decodeHTML(stripHTML(postprocess(source)));
}

function renderInlineSource(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "br") return "\n";
      if (token.type === "codespan") {
        return `<code>${encodeHTML(token.text)}</code>`;
      }
      if (token.type === "html") {
        const escaped = escapeUnterminatedDelimitedHTML(token.text);
        if (escaped !== token.text) return escaped;
        return isSmartypantsLiteralTag(token.text)
          ? token.text
          : stripHTML(token.text);
      }
      if (hasTokens(token)) return renderInlineSource(token.tokens);
      return "text" in token && typeof token.text === "string"
        ? escapeMalformedDelimiters(token.text)
        : "";
    })
    .join("");
}

function isSmartypantsLiteralTag(value: string): boolean {
  return new RegExp(
    `^<\\/?(?:${smartypantsLiteralHTMLTagNames})(?=[\\s/>])`,
    "i",
  ).test(value);
}

function renderText(tokens: readonly Token[]): string {
  return tokens.map(renderTokenText).join("");
}

function renderTokenText(token: Token): string {
  if (isList(token)) {
    return `${token.items
      .map((item) => renderText(item.tokens).trim())
      .join("\n")}\n`;
  }
  if (isTable(token)) {
    return `${[token.header, ...token.rows]
      .flat()
      .map((cell) => renderInlineText(cell.tokens))
      .join(" ")}\n`;
  }
  if (hasTokens(token)) {
    const text =
      token.type === "blockquote"
        ? renderText(token.tokens)
        : renderInlineText(token.tokens);
    return token.type === "paragraph" ||
      token.type === "heading" ||
      token.raw.endsWith("\n")
      ? `${text}\n`
      : text;
  }
  if (token.type === "space") return "\n";
  if (token.type === "code") return `${token.text}\n`;
  if (token.type === "html") {
    const source = escapeUnterminatedDelimitedHTML(token.text);
    const text = decodeHTML(stripHTML(postprocess(source)));
    return text ? `${text}\n` : "";
  }
  const text =
    "text" in token && typeof token.text === "string"
      ? decodeHTML(postprocess(token.text))
      : "";
  return text;
}

function postprocess(value: string): string {
  const hook = markdownParser.defaults.hooks?.postprocess;
  if (!hook) return value;
  let marker: string | null = null;
  const tags: string[] = [];
  const tagsWithoutCloser = new Set<string>();
  let protectedValue = "";
  let cursor = 0;
  let index = value.indexOf("<");
  while (index !== -1) {
    const tagScan = findHTMLTagEnd(value, index);
    if (tagScan.end === null) {
      index = value.indexOf("<", index + 1);
      continue;
    }
    const tag = value.slice(index, tagScan.end + 1);
    const tagName = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(tag)?.[1];
    if (
      tagName &&
      new RegExp(`^(?:${colonOpaqueHTMLTagNames})$`, "i").test(tagName) &&
      !tagsWithoutCloser.has(tagName.toLowerCase()) &&
      !/\/>$/.test(tag)
    ) {
      const closingPattern = new RegExp(`</${tagName}\\s*>`, "gi");
      closingPattern.lastIndex = tagScan.end + 1;
      const closing = closingPattern.exec(value);
      if (closing) {
        marker ??= createHTMLMarker(value);
        const end = closing.index + closing[0].length;
        protectedValue += value.slice(cursor, index);
        protectedValue += `<${tagName} ${marker}="${tags.length}"/>`;
        tags.push(value.slice(index, end));
        cursor = end;
        index = value.indexOf("<", cursor);
        continue;
      }
      tagsWithoutCloser.add(tagName.toLowerCase());
    }
    const naiveEnd = value.indexOf(">", index + 1);
    if (naiveEnd === tagScan.end) {
      index = value.indexOf("<", tagScan.end + 1);
      continue;
    }
    if (!tagName) {
      index = value.indexOf("<", tagScan.end + 1);
      continue;
    }
    marker ??= createHTMLMarker(value);
    protectedValue += value.slice(cursor, index);
    protectedValue += `<${tagName} ${marker}="${tags.length}"${/\/>$/.test(tag) ? "/" : ""}>`;
    tags.push(tag);
    cursor = tagScan.end + 1;
    index = value.indexOf("<", cursor);
  }
  if (tags.length === 0) return hook(value);
  protectedValue += value.slice(cursor);
  return hook(protectedValue).replace(
    new RegExp(`<[A-Za-z][A-Za-z0-9:-]* ${marker}="(\\d+)"/?>`, "g"),
    (_, tagIndex: string) => tags[Number(tagIndex)],
  );
}

function createHTMLMarker(value: string): string {
  let marker: string;
  do {
    marker = `data-changelog-parser-${randomUUID().replaceAll("-", "")}`;
  } while (value.includes(marker));
  return marker;
}

function stripHTML(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "<") {
      result += value[index];
      index += 1;
      continue;
    }
    const tagScan = findHTMLTagEnd(value, index);
    if (tagScan.end === null) {
      if (tagScan.unterminated) {
        result += value.slice(index);
        break;
      }
      result += value[index];
      index += 1;
    } else {
      index = tagScan.end + 1;
    }
  }
  return result;
}

function findHTMLTagEnd(
  value: string,
  start: number,
): { end: number | null; unterminated: boolean } {
  if (value.startsWith("<!--", start)) {
    const end = value.indexOf("-->", start + 4);
    return end === -1
      ? { end: null, unterminated: true }
      : { end: end + 2, unterminated: false };
  }
  if (value.startsWith("<![CDATA[", start)) {
    const end = value.indexOf("]]>", start + 9);
    return end === -1
      ? { end: null, unterminated: true }
      : { end: end + 2, unterminated: false };
  }

  let index = start + 1;
  if (value[index] === "/") index += 1;

  if (/[A-Za-z]/.test(value[index] ?? "")) {
    index += 1;
    while (/[A-Za-z0-9:-]/.test(value[index] ?? "")) index += 1;
    if (!/[\s/>]/.test(value[index] ?? "")) {
      return { end: null, unterminated: index === value.length };
    }
  } else if (value[index] === "!" || value[index] === "?") {
    index += 1;
  } else {
    return { end: null, unterminated: false };
  }

  let quote: '"' | "'" | null = null;
  for (; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "<") {
      return { end: null, unterminated: true };
    } else if (character === ">") {
      return { end: index, unterminated: false };
    }
  }
  return { end: null, unterminated: true };
}

function findMalformedHTMLRecoveryEnd(value: string): number {
  let index = 1;
  if (value[index] === "/") index += 1;
  while (/[A-Za-z0-9:-]/.test(value[index] ?? "")) index += 1;
  let emailStart = -1;
  let emailState: "local" | "domain-start" | "domain" | "domain-tail" = "local";
  for (; index < value.length; index += 1) {
    if (value[index] === "\r" || value[index] === "\n") {
      let lineEnd = index;
      while (value[lineEnd - 1] === " " || value[lineEnd - 1] === "\t") {
        lineEnd -= 1;
      }
      if (lineEnd !== index) return lineEnd;
      emailStart = -1;
      emailState = "local";
      continue;
    }
    if (/^[\\<![`*~_]$/.test(value[index])) return index;
    if (
      startsWithIgnoringCase(value, index, "http://") ||
      startsWithIgnoringCase(value, index, "https://") ||
      startsWithIgnoringCase(value, index, "www.")
    ) {
      return index;
    }
    const character = value[index];
    switch (emailState) {
      case "local":
        if (/^[A-Za-z0-9._+-]$/.test(character)) {
          if (emailStart === -1) emailStart = index;
        } else if (character === "@" && emailStart !== -1) {
          emailState = "domain-start";
        } else {
          emailStart = -1;
        }
        break;
      case "domain-start":
        if (/^[A-Za-z0-9-_]$/.test(character)) {
          emailState = "domain";
        } else {
          emailStart = /^[A-Za-z0-9._+-]$/.test(character) ? index : -1;
          emailState = "local";
        }
        break;
      case "domain":
        if (character === ".") {
          emailState = "domain-tail";
        } else if (!/^[A-Za-z0-9-_]$/.test(character)) {
          emailStart = /^[A-Za-z0-9._+-]$/.test(character) ? index : -1;
          emailState = "local";
        }
        break;
      case "domain-tail":
        if (/^[A-Za-z0-9]$/.test(character)) return emailStart;
        if (!/^[A-Za-z0-9-_]$/.test(character)) {
          emailStart = /^[A-Za-z0-9._+-]$/.test(character) ? index : -1;
          emailState = "local";
        }
        break;
    }
  }
  return value.length;
}

function startsWithIgnoringCase(
  value: string,
  index: number,
  prefix: string,
): boolean {
  if (index + prefix.length > value.length) return false;
  for (let offset = 0; offset < prefix.length; offset += 1) {
    if (value[index + offset].toLowerCase() !== prefix[offset]) return false;
  }
  return true;
}

function hasTokens(token: Token): token is Token & { tokens: Token[] } {
  return "tokens" in token && Array.isArray(token.tokens);
}

function isTable(token: Token): token is Tokens.Table {
  return token.type === "table" && Array.isArray(token.rows);
}

function parseDate(text: string): string | null {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoMatch) {
    return normalizeDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const localMatch = /^(\d{2})([-/])(\d{2})\2(\d{2}|\d{4})$/.exec(text);
  if (localMatch) {
    const shortYear = Number(localMatch[4]);
    const year =
      localMatch[4].length === 4
        ? shortYear
        : shortYear <= 60
          ? 2000 + shortYear
          : 1900 + shortYear;
    return normalizeDate(year, Number(localMatch[1]), Number(localMatch[3]));
  }
  return null;
}

function normalizeDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
