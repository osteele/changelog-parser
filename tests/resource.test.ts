import { expect, test } from "bun:test";
import parseChangeLog from "../src";

const resourceBudgetMs = readResourceBudget();
const resourceHarnessTimeoutMs = 120_000;

function readResourceBudget(): number {
  const value = process.env.RESOURCE_BUDGET_MS;
  if (value === undefined) return 10_000;
  const budget = Number(value);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new TypeError(
      `RESOURCE_BUDGET_MS must be a positive number, got ${value}`,
    );
  }
  return budget;
}

function runWithinBudget<T>(
  label: string,
  run: () => T,
  budgetMs = resourceBudgetMs,
): T {
  const { elapsed, result } = runTimed(run);
  expect(elapsed, `${label} took ${elapsed.toFixed(1)} ms`).toBeLessThan(
    budgetMs,
  );
  return result;
}

function runTimed<T>(run: () => T): { elapsed: number; result: T } {
  const start = process.cpuUsage();
  const result = run();
  const usage = process.cpuUsage(start);
  const elapsed = (usage.user + usage.system) / 1_000;
  return { elapsed, result };
}

function parseMalformedTitle(payload: string) {
  return parseChangeLog({
    text: `# ${payload}`,
    outputFormat: "text",
    recognizeColonSections: false,
  });
}

test(
  "keeps malformed HTML opener families within the resource budget",
  () => {
    const inputs = [
      ["tag starts", "<a ".repeat(12_000), resourceBudgetMs],
      ["long plain suffix", `<a ${"a".repeat(64_000)}`, 2_000],
      ["quoted attributes", '<a title="'.repeat(3_000), resourceBudgetMs],
      ["comments", "<!-- ".repeat(5_000), resourceBudgetMs],
      ["CDATA", "<![CDATA[".repeat(2_500), resourceBudgetMs],
      ["processing instructions", "<?target ".repeat(3_000), resourceBudgetMs],
    ] as const;

    for (const [label, payload, budgetMs] of inputs) {
      const changeLog = runWithinBudget(
        label,
        () =>
          parseChangeLog({
            text: `# ${payload}`,
            outputFormat: "text",
            recognizeColonSections: false,
          }),
        budgetMs,
      );
      expect(typeof changeLog.title).toBe("string");
    }
  },
  resourceHarnessTimeoutMs,
);

test(
  "keeps unterminated delimited-opener scaling near linear",
  () => {
    for (const [label, opener] of [
      ["comments", "<!-- "],
      ["CDATA", "<![CDATA["],
      ["soft-wrapped comments", "text <!-- open\n"],
      ["soft-wrapped CDATA", "text <![CDATA[ open\n"],
    ] as const) {
      parseMalformedTitle(opener.repeat(250));
      const small = runTimed(() => parseMalformedTitle(opener.repeat(1_000)));
      const large = runTimed(() => parseMalformedTitle(opener.repeat(8_000)));

      expect(
        large.elapsed,
        `${label} scaling took ${large.elapsed.toFixed(1)} ms at 8,000 openers versus ${small.elapsed.toFixed(1)} ms at 1,000`,
      ).toBeLessThan(small.elapsed * 12 + 500);
      expect(typeof large.result.title).toBe("string");
    }
  },
  resourceHarnessTimeoutMs,
);

test(
  "keeps unmatched literal HTML tags near linear",
  () => {
    const parseTags = (count: number) =>
      parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${"<style>".repeat(count)}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });
    parseTags(50);
    const small = runTimed(() => parseTags(200));
    const large = runTimed(() => parseTags(1_600));

    expect(
      large.elapsed,
      `literal-tag scaling took ${large.elapsed.toFixed(1)} ms at 1,600 tags versus ${small.elapsed.toFixed(1)} ms at 200`,
    ).toBeLessThan(small.elapsed * 12 + 500);
    expect(large.result.versions[0].body).toContain("<style>");
  },
  resourceHarnessTimeoutMs,
);

test(
  "keeps many complete inline literal elements near linear",
  () => {
    const parseElements = (count: number) => {
      const raw = Array.from(
        { length: count },
        (_, index) => `<code>x${index} <!-- y</code>`,
      ).join(" ");
      return parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${raw}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });
    };
    parseElements(100);
    const small = runTimed(() => parseElements(400));
    const large = runTimed(() => parseElements(3_200));

    expect(
      large.elapsed,
      `complete literal-element scaling took ${large.elapsed.toFixed(1)} ms at 3,200 elements versus ${small.elapsed.toFixed(1)} ms at 400`,
    ).toBeLessThan(small.elapsed * 12 + 500);
    expect(large.elapsed).toBeLessThan(2_000);
    expect(large.result.versions[0].changes[0].body).toContain(
      "<code>x3199 <!-- y</code>",
    );
  },
  resourceHarnessTimeoutMs,
);

test(
  "bounds malformed-delimiter overhead across Markdown blocks",
  () => {
    for (const [label, baselineFragment, malformedFragment] of [
      ["list comments", "- text plain open\n", "- text <!-- open\n"],
      ["list CDATA", "- text plain open\n", "- text <![CDATA[ open\n"],
      ["paragraph comments", "text plain open\n\n", "text <!-- open\n\n"],
      ["paragraph CDATA", "text plain open\n\n", "text <![CDATA[ open\n\n"],
      ["blockquote comments", "> text plain open\n\n", "> text <!-- open\n\n"],
      [
        "blockquote CDATA",
        "> text plain open\n\n",
        "> text <![CDATA[ open\n\n",
      ],
    ] as const) {
      const baseline = runTimed(() =>
        parseMalformedTitle(baselineFragment.repeat(500)),
      );
      const malformed = runTimed(() =>
        parseMalformedTitle(malformedFragment.repeat(500)),
      );
      expect(
        malformed.elapsed,
        `${label} took ${malformed.elapsed.toFixed(1)} ms versus ${baseline.elapsed.toFixed(1)} ms for matched plain Markdown`,
      ).toBeLessThan(baseline.elapsed * 2 + 500);
      expect(typeof malformed.result.title).toBe("string");
    }
  },
  resourceHarnessTimeoutMs,
);

test(
  "keeps grammar-aware malformed HTML recovery within the resource budget",
  () => {
    const recoveries = [
      ["<a attr=", "**bold**", "bold"],
      ['<x title="', "[link](/url)", "link"],
      ["<broken data=", "`code`", "code"],
      ["<tag class=", "https://example.com", "https://example.com"],
      ["<tag class=", "user@example.com", "user@example.com"],
      ["<tag class=", "~~removed~~", "removed"],
    ] as const;
    const count = 600;
    const items = Array.from({ length: count }, (_, index) => {
      const [prefix, markdown] = recoveries[index % recoveries.length];
      return `- case-${index} before ${prefix} ${markdown}`;
    });
    const changeLog = runWithinBudget("grammar-aware recovery", () =>
      parseChangeLog({
        text: `## 1.0.0\n### Fixed\n${items.join("\n")}`,
        outputFormat: "html",
        recognizeColonSections: false,
      }),
    );

    expect(changeLog.versions[0].changes).toHaveLength(count);
    const mismatch = changeLog.versions[0].changes.findIndex(
      ({ body }, index) =>
        !body.includes(recoveries[index % recoveries.length][2]),
    );
    expect(mismatch, `first recovery mismatch at item ${mismatch}`).toBe(-1);
  },
  resourceHarnessTimeoutMs,
);

test(
  "keeps mixed colon-section opacity within the resource budget",
  () => {
    const opaqueFragments = [
      (index: number) => `\`code-${index}\``,
      (index: number) => `[link-${index}](url)`,
      (index: number) => `<span title="<style>">text-${index}</span>`,
      (index: number) => `\\<style> literal-${index}`,
    ];
    const pairs = Array.from({ length: 1_600 }, (_, index) => {
      const fragment = opaqueFragments[index % opaqueFragments.length](index);
      return `${fragment}\nAdded:`;
    });
    const baseline = runTimed(() =>
      parseChangeLog({
        text: `## 1.0.0\n${pairs.join("\n")}\n- actual`,
        outputFormat: "text",
        recognizeColonSections: false,
      }),
    );
    const recognized = runTimed(() =>
      parseChangeLog({
        text: `## 1.0.0\n${pairs.join("\n")}\n- actual`,
        outputFormat: "text",
      }),
    );

    expect(
      recognized.elapsed,
      `colon recognition took ${recognized.elapsed.toFixed(1)} ms versus ${baseline.elapsed.toFixed(1)} ms without recognition`,
    ).toBeLessThan(resourceBudgetMs);
    expect(
      recognized.elapsed,
      `colon recognition overhead exceeded the paired baseline: ${recognized.elapsed.toFixed(1)} ms versus ${baseline.elapsed.toFixed(1)} ms`,
    ).toBeLessThan(baseline.elapsed * 3 + 1_000);

    expect(recognized.result.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);
  },
  resourceHarnessTimeoutMs,
);
