import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMutationSandboxManager } from "./mutation-sandbox.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = fs.readFileSync(path.join(projectRoot, "src/index.ts"), "utf8");
const defaultTestFiles = [
  "tests/index.test.ts",
  "tests/contracts.test.ts",
  "tests/properties.test.ts",
];
const mutations = [
  {
    name: "default title",
    find: 'defaultTitle: "Release Notes",',
    replace: 'defaultTitle: "Release Log",',
  },
  {
    name: "default category order",
    find: '    "Added",\n    "New",',
    replace: '    "New",\n    "Added",',
  },
  {
    name: "omit-unreleased default",
    find: "omitUnreleasedVersions: true,",
    replace: "omitUnreleasedVersions: false,",
  },
  {
    name: "output-format default",
    find: 'outputFormat: "html",',
    replace: 'outputFormat: "text",',
  },
  {
    name: "colon-section default",
    find: "recognizeColonSections: true,",
    replace: "recognizeColonSections: false,",
  },
  {
    name: "undefined option resolution",
    find: "return value === undefined ? defaultValue : value;",
    replace: "return value !== undefined ? defaultValue : value;",
  },
  {
    name: "case-insensitive unreleased matching",
    find: "!/^unreleased$/i.test(",
    replace: "!/^unreleased$/.test(",
  },
  {
    name: "unreleased filtering branch",
    find: "if (options.omitUnreleasedVersions) {",
    replace: "if (!options.omitUnreleasedVersions) {",
  },
  {
    name: "version component limit",
    find: "/^\\d+(?:\\.\\d+){0,2}(?:[^.\\s]\\S*)?$/",
    replace: "/^\\d+(?:\\.\\d+){0,3}(?:[^.\\s]\\S*)?$/",
  },
  {
    name: "two-digit year boundary",
    find: "shortYear <= 60",
    replace: "shortYear < 60",
  },
  {
    name: "date month offset",
    find: "date.setUTCFullYear(year, month - 1, day);",
    replace: "date.setUTCFullYear(year, month, day);",
  },
  {
    name: "date validation",
    find: "date.getUTCFullYear() !== year ||",
    replace: "date.getUTCFullYear() === year ||",
  },
  {
    name: "local-date separator consistency",
    find: "(\\d{2})([-/])(\\d{2})\\2(\\d{2}|\\d{4})",
    replace: "(\\d{2})([-/])(\\d{2})[-/](\\d{2}|\\d{4})",
  },
  {
    name: "date normalization",
    find: "date = parseDate(m[2]) ?? m[2];",
    replace: "date = m[2];",
  },
  {
    name: "colon-section case matching",
    find: "):(?=\\r?$)/gim;",
    replace: "):(?=\\r?$)/gm;",
  },
  {
    name: "raw HTML block opacity",
    find: '    token.type === "html"\n',
    replace: "    false\n",
  },
  {
    name: "style and textarea opacity",
    find: "|style|textarea",
    replace: "",
  },
  {
    name: "inline opaque-region protection",
    find: "if (range && range[0] <= offset) continue;",
    replace: "if (false) continue;",
  },
  {
    name: "non-text inline opacity",
    find: '} else if (token.type !== "text") {',
    replace: "} else if (false) {",
  },
  {
    name: "block-local inline tokenization",
    find: "const opaqueRanges = findInlineOpaqueRanges(sourceBlocks);",
    replace:
      'const opaqueRanges = findInlineOpaqueRanges([{ type: "paragraph", raw: value, text: value, tokens: markdownParser.Lexer.lexInline(value, markdownParser.defaults) }]);',
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "literal-tag closing boundary",
    find: ["`^</$", "{tagName}\\\\s*>`"].join(""),
    replace: ["`</$", "{tagName}\\\\s*>`"].join(""),
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "unknown category rank",
    find: "const unknownRank = categoryRanks.size;",
    replace: "const unknownRank = 0;",
  },
  {
    name: "duplicate category ranks",
    find: "if (!ranks.has(category)) {",
    replace: "if (ranks.has(category)) {",
  },
  {
    name: "disabled category sorting",
    find: "if (!order) {",
    replace: "if (order) {",
  },
  {
    name: "section body ownership",
    find: "sections.at(-1)?.body.push(token);",
    replace: "sections.at(0)?.body.push(token);",
  },
  {
    name: "change list extraction",
    find: "return body.filter(isList).flatMap(({ items }) =>",
    replace: "return body.filter(() => false).flatMap(({ items }) =>",
  },
  {
    name: "task-list checked state",
    find: 'item.checked ? "x" : " "',
    replace: 'item.checked ? " " : " "',
  },
  {
    name: "inline HTML comments",
    find: 'if (value.startsWith("<!--", start)) {',
    replace: "if (false) {",
  },
  {
    name: "unterminated HTML Markdown recovery",
    find: "const recoveryEnd = findMalformedHTMLRecoveryEnd(value);",
    replace: "const recoveryEnd = value.length;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "malformed HTML email recovery",
    find: 'character === "@" && emailStart !== -1',
    replace: "false",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "global malformed delimiter preprocessing",
    find: "const prepared = prepareMarkdown(text);",
    replace: "const prepared = { value: text, markers: null };",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "compact malformed delimiter markers",
    find: "prepared += isComment ? markers.comment : markers.cdata;",
    replace:
      "prepared += `\u0024{isComment ? markers.comment : markers.cdata}\u0024{value.slice(index + 1, index + (isComment ? 4 : 9))}`;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "literal-element opaque-range protection",
    find: "if (opaqueRange && opaqueRange[0] <= index) {",
    replace: "if (false && opaqueRange && opaqueRange[0] <= index) {",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "literal-element closing-tag recognition",
    find: "if (openingIndex !== undefined) {",
    replace: "if (false && openingIndex !== undefined) {",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "nested literal-element range normalization",
    find: "return mergeOverlappingRanges(ranges);",
    replace: "return ranges;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "mixed Markdown container prefixes",
    find: 'pendingIndentation = "";\n      cursor += listMarker[0].length;\n      continue;',
    replace:
      'pendingIndentation = "";\n      cursor += listMarker[0].length;\n      return { cursor, listDepth, quoteDepth, containers };',
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "tab-separated blockquote prefix",
    find: 'if (value[cursor] === " " || value[cursor] === "\\t") {',
    replace: 'if (value[cursor] === " ") {',
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "noninterrupting ordered-list prefix",
    find: 'container.kind === "ordered" && container.start !== 1,',
    replace: 'container.kind === "ordered" && container.start === 1,',
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "delimiter container ownership",
    find: "return column - whitespaceStartColumn >= requiredIndent;",
    replace: "return true;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "lazy list-item delimiter continuation",
    find: 'pending.containerPath?.every((container) => container.kind !== "quote")',
    replace: "false",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "lazy nested-list continuation after quote",
    find: "if (sawQuote) return true;",
    replace: "if (sawQuote) return false;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "reject changed quote ownership after lazy continuation",
    find: 'value[cursor] === ">" ||',
    replace: 'value[cursor] !== ">" ||',
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "reject sibling list marker after lazy continuation",
    find: "/^(?:[*+-](?:[ \\t]+|$)|\\d{1,9}[.)](?:[ \\t]+|$))/.test(",
    replace:
      "false && /^(?:[*+-](?:[ \\t]+|$)|\\d{1,9}[.)](?:[ \\t]+|$))/.test(",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "reject hard Markdown block after lazy continuation",
    find: "startsMarkdownBlock(value.slice(cursor))",
    replace: "false && startsMarkdownBlock(value.slice(cursor))",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "cap ordered-list continuation indentation",
    find: "? Math.min(\n            5,",
    replace: "? Math.max(\n            5,",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "text restoration for protected literal elements",
    find: "result += value.slice(offset, start) + restore(source);",
    replace: "result += value.slice(offset, start) + source;",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "quote-aware raw HTML postprocessing",
    find: "if (naiveEnd === tagScan.end) {",
    replace: "if (true) {",
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "escaped malformed HTML recovery",
    find: `const recoveryEnd = findMalformedHTMLRecoveryEnd(value);
        const raw = value.slice(0, recoveryEnd);
        return {
          type: "text",
          raw,
          text: escapeMalformedHTML(raw),`,
    replace: `const recoveryEnd = findMalformedHTMLRecoveryEnd(value);
        const raw = value.slice(0, recoveryEnd);
        return {
          type: "text",
          raw,
          text: raw,`,
    testFiles: ["tests/contracts.test.ts"],
  },
  {
    name: "block-code literal text",
    find: 'if (token.type === "code") return `\u0024{token.text}\\n`;',
    replace:
      'if (token.type === "code") return `\u0024{postprocess(token.text)}\\n`;',
  },
  {
    name: "raw inline-code literal text",
    find: "return isSmartypantsLiteralTag(token.text)",
    replace: "return false",
  },
  {
    name: "prototype-safe categories",
    find: "const existing = Object.hasOwn(categories, type)",
    replace: "const existing = true",
  },
  {
    name: "enumerable categories",
    find: "enumerable: true,",
    replace: "enumerable: false,",
  },
];

function replaceOnce(input, mutation) {
  const count = input.split(mutation.find).length - 1;
  if (count !== 1) {
    throw new Error(
      `${mutation.name}: expected one mutation target, found ${count}`,
    );
  }
  return input.replace(mutation.find, mutation.replace);
}

const activeChildren = new Set();
const sandboxManager = createMutationSandboxManager(projectRoot);

function runTests(sandbox, testFiles = defaultTestFiles, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bun",
      ["test", ...testFiles.map((file) => path.join(sandbox, file))],
      {
        cwd: sandbox,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChildren.add(child);
    let output = "";
    const collect = (chunk) => {
      output = `${output}${chunk}`.slice(-4_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    let forceKillTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      activeChildren.delete(child);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      activeChildren.delete(child);
      resolve({ code, output, signal, timedOut });
    });
  });
}

function createSandbox(sourceText) {
  const sandbox = sandboxManager.createSandbox();
  try {
    fs.mkdirSync(path.join(sandbox, "src"));
    fs.cpSync(path.join(projectRoot, "tests"), path.join(sandbox, "tests"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(sandbox, "src/index.ts"), sourceText);
    return sandbox;
  } catch (error) {
    sandboxManager.removeSandbox(sandbox);
    throw error;
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    for (const child of activeChildren) child.kill(signal);
    try {
      sandboxManager.cleanup();
    } finally {
      process.kill(process.pid, signal);
    }
  });
}
process.once("exit", () => sandboxManager.cleanup());
sandboxManager.start();

async function runBaseline(testFiles) {
  const sandbox = createSandbox(source);
  try {
    const result = await runTests(sandbox, testFiles, 180_000);
    if (result.timedOut || result.code !== 0) {
      throw new Error(
        `Mutation baseline failed for ${testFiles.join(", ")}\n${result.output}`,
      );
    }
    process.stdout.write(`BASELINE PASSED ${testFiles.join(", ")}\n`);
  } finally {
    sandboxManager.removeSandbox(sandbox);
  }
}

async function runMutation(mutation) {
  const sandbox = createSandbox(replaceOnce(source, mutation));
  try {
    const result = await runTests(sandbox, mutation.testFiles);
    const outcome = result.timedOut
      ? "timeout"
      : result.code === 0
        ? "survived"
        : /\n\s*\d+ fail\b/.test(result.output)
          ? "killed"
          : "invalid";
    return { ...mutation, ...result, outcome };
  } finally {
    sandboxManager.removeSandbox(sandbox);
  }
}

const mutationFilter = process.env.MUTATION_FILTER;
const selectedMutations = mutationFilter
  ? mutations.filter(({ name }) => name.includes(mutationFilter))
  : mutations;
if (selectedMutations.length === 0) {
  throw new Error(`No mutations match MUTATION_FILTER=${mutationFilter}`);
}
const requestedConcurrency = Number(process.env.MUTATION_CONCURRENCY ?? 4);
if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency < 1) {
  throw new TypeError(
    `MUTATION_CONCURRENCY must be a positive integer, got ${process.env.MUTATION_CONCURRENCY}`,
  );
}
const concurrency = Math.max(
  1,
  Math.min(selectedMutations.length, requestedConcurrency),
);
const results = [];
let nextMutation = 0;

const baselineProfiles = new Map();
for (const mutation of selectedMutations) {
  const testFiles = mutation.testFiles ?? defaultTestFiles;
  baselineProfiles.set(JSON.stringify(testFiles), testFiles);
}
for (const testFiles of baselineProfiles.values()) {
  await runBaseline(testFiles);
}

async function worker() {
  while (nextMutation < selectedMutations.length) {
    const mutation = selectedMutations[nextMutation];
    nextMutation += 1;
    results.push(await runMutation(mutation));
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const mutationRanks = new Map(
  selectedMutations.map((mutation, index) => [mutation.name, index]),
);
results.sort(
  (left, right) =>
    (mutationRanks.get(left.name) ?? 0) - (mutationRanks.get(right.name) ?? 0),
);

const survivors = results.filter(({ outcome }) => outcome === "survived");
const invalid = results.filter(
  ({ outcome }) => outcome === "invalid" || outcome === "timeout",
);
const killed = results.filter(({ outcome }) => outcome === "killed");
for (const result of results) {
  process.stdout.write(`${result.outcome.toUpperCase()} ${result.name}\n`);
}
process.stdout.write(
  `Mutation score: ${killed.length}/${results.length} assertion-killed\n`,
);
if (survivors.length > 0 || invalid.length > 0) process.exitCode = 1;
