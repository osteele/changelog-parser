import { marked } from "marked";
import parseChangeLog from "../src/index.ts";

const prefixes = [
  "- ",
  "- - ",
  "- - - ",
  "1. ",
  "1.  ",
  "> - ",
  "> - - ",
  "> - - - ",
];
const continuations = [
  "\t",
  "\t ",
  "\t  ",
  "\t\t",
  "\t\t ",
  "\t\t  ",
  "\t\t\t",
  "\t\t\t ",
  "  ",
  "   ",
  "    ",
];
const mismatches = [];

for (const prefix of prefixes) {
  for (const continuation of continuations) {
    const text = `## 1\n### Fixed\n> ${prefix}<!-- x\n> ${continuation}# y -->`;
    const expectedTokens = marked.lexer(
      `### Fixed\n> ${prefix}<!-- x\n> ${continuation}# y -->`,
    );
    const actual =
      parseChangeLog({
        text,
        outputFormat: "html",
        recognizeColonSections: false,
      }).versions[0]?.body ?? "";
    const expectedRaw = hasCompleteRawDelimiter(expectedTokens);
    const actualRaw = actual.includes("<!-- x");
    if (expectedRaw !== actualRaw)
      mismatches.push({ prefix, continuation, expectedRaw, actualRaw });
  }
}

function hasCompleteRawDelimiter(tokens) {
  for (const token of tokens) {
    if (
      token.type === "html" &&
      ((token.raw.startsWith("<!--") && token.raw.includes("-->")) ||
        (token.raw.startsWith("<![CDATA[") &&
          token.raw.includes("]] >".replace(" ", ""))))
    ) {
      return true;
    }
    if (Array.isArray(token.tokens) && hasCompleteRawDelimiter(token.tokens)) {
      return true;
    }
    if (
      token.type === "list" &&
      token.items.some((item) => hasCompleteRawDelimiter(item.tokens))
    ) {
      return true;
    }
  }
  return false;
}

console.log(
  JSON.stringify(
    { cases: prefixes.length * continuations.length, mismatches },
    null,
    2,
  ),
);
if (process.argv.includes("--fail") && mismatches.length > 0)
  process.exitCode = 1;
