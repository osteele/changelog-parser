import { expect, test } from "bun:test";
import parseChangeLog from "../src";

test("keeps escaped malformed delimiters out of the HTML postprocessor", () => {
  for (const payload of ["<!-- ".repeat(8_000), "<![CDATA[".repeat(8_000)]) {
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
    ).toBeLessThan(1_000);
    expect(typeof result.title).toBe("string");
  }
}, 10_000);
