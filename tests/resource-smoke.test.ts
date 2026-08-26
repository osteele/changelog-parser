import { expect, test } from "bun:test";
import parseChangeLog from "../src";

test("rejects repeated malformed-HTML suffix scans promptly", () => {
  const inputs = [
    [`<a ${"a".repeat(24_000)}`, 1_000],
    ["<!-- ".repeat(64_000), 1_500],
    ["<![CDATA[".repeat(8_000), 1_000],
    ["text <![CDATA[ open\n".repeat(4_000), 1_000],
  ] as const;

  for (const [payload, budgetMs] of inputs) {
    const start = process.cpuUsage();
    const result = parseChangeLog({
      text: `# ${payload}`,
      outputFormat: "text",
      recognizeColonSections: false,
    });
    const usage = process.cpuUsage(start);
    const elapsed = (usage.user + usage.system) / 1_000;
    expect(
      elapsed,
      `${payload.length} bytes took ${elapsed.toFixed(1)} ms`,
    ).toBeLessThan(budgetMs);
    expect(typeof result.title).toBe("string");
  }
}, 120_000);
