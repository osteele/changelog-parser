import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { marked } from "marked";
import parseChangeLog, { parseChangeLog as namedParseChangeLog } from "../src";

describe("parseChangeLog", () => {
  const filePath = `${__dirname}/testdata/CHANGELOG.md`;
  const text = fs.readFileSync(filePath, "utf-8");

  test("parses a string", () => {
    const changeLog = parseChangeLog({ text });
    expect(changeLog).toHaveProperty("title", "Change Log");
  });

  test("parses a file", () => {
    const changeLog = parseChangeLog({ filePath });
    expect(changeLog).toHaveProperty("title", "Change Log");
  });

  test("works with a string parameter", () => {
    const changeLog = parseChangeLog(filePath);
    expect(changeLog).toHaveProperty("title", "Change Log");
  });

  test("has matching default and named exports", () => {
    expect(parseChangeLog).toBe(namedParseChangeLog);
  });

  test("does not modify the shared Marked parser", () => {
    expect(marked.parse('"straight" -- dash')).toBe(
      "<p>&quot;straight&quot; -- dash</p>\n",
    );
  });

  const changeLog = parseChangeLog({ text });

  test("has a title property", () => {
    expect(changeLog).toHaveProperty("title", "Change Log");
  });

  test("has a versions array", () => {
    expect(changeLog.versions).toBeInstanceOf(Array);
  });

  describe("version", () => {
    test("has a title property", () => {
      expect(changeLog.versions[0].title).toBe("[1.1.8] - 2021-10-28");
    });
    test("has a version property", () => {
      expect(changeLog.versions[0].version).toBe("1.1.8");
    });
    test("has a date property", () => {
      expect(changeLog.versions[0].date).toBe("2021-10-28");
    });
    test("has an map of change types", () => {
      expect(changeLog.versions[0].changes).toBeInstanceOf(Array);
      expect(changeLog.versions[0].categories).toBeInstanceOf(Object);
    });
  });

  test.each(["2021-11-04", "11-04-2021", "11-04-21", "11/04/2021", "11/04/21"])(
    "parses the supported date format %s",
    (date) => {
      const changeLog = parseChangeLog({ text: `## 1.0.0 - ${date}` });
      expect(changeLog.versions[0].date).toBe("2021-11-04");
    },
  );

  test("preserves unrecognized dates", () => {
    const changeLog = parseChangeLog({ text: "## 1.0.0 - someday" });
    expect(changeLog.versions[0].date).toBe("someday");
  });

  test("ignores headings nested inside block quotes", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 2.0.0",
        "### Fixed",
        "- current",
        "> ## Quoted heading",
        "> ### Quoted category",
        "> - quoted item",
        "## 1.0.0",
        "### Fixed",
        "- previous",
      ].join("\n\n"),
    });

    expect(changeLog.versions.map(({ version }) => version)).toEqual([
      "2.0.0",
      "1.0.0",
    ]);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: "current" },
    ]);
  });

  test("supports category names inherited by Object.prototype", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n\n### constructor\n\n- item",
    });
    const categoryName: string = "constructor";
    expect(changeLog.versions[0].categories[categoryName]).toEqual(["item"]);
  });

  describe("changes", () => {
    test("parses multiple-line changes", () => {
      expect(changeLog.versions[0].changes[0].body.replace(/\n/g, " ")).toMatch(
        /to the library list/,
      );
    });

    test("preserves links", () => {
      expect(changeLog.versions[0].changes[0].body).toContain("<a href=");
    });

    test("obeys options.outputFormat: text", () => {
      const changeLog = parseChangeLog({ text, outputFormat: "text" });
      expect(changeLog.versions[0].changes[0].body).toContain(
        "Add antiboredom/p5.patgrad to the",
      );
    });

    test("obeys options.outputFormat: markdown", () => {
      const changeLog = parseChangeLog({ text, outputFormat: "markdown" });
      expect(changeLog.versions[0].changes[0].body).toContain(
        "Add [antiboredom/p5.patgrad](https://github.com/antiboredom/p5.patgrad) to the",
      );
    });

    test("preserves task markers in Markdown output", () => {
      const changeLog = parseChangeLog({
        text: "## 1.0.0\n\n### Fixed\n\n- [x] done\n- [ ] todo",
        outputFormat: "markdown",
      });
      expect(changeLog.versions[0].categories.Fixed).toEqual([
        "[x] done",
        "[ ] todo",
      ]);
    });

    test("preserves code and comparisons in text output", () => {
      const changeLog = parseChangeLog({
        text: [
          '# <span title="x > y">Release Notes</span>',
          "## 1.0.0",
          "### Fixed",
          "- Keep `<button>` when x < y and y > z",
        ].join("\n\n"),
        outputFormat: "text",
      });
      expect(changeLog.title).toBe("Release Notes");
      expect(changeLog.versions[0].changes[0].body).toBe(
        "Keep <button> when x < y and y > z",
      );
    });

    test("preserves raw HTML in HTML output", () => {
      const changeLog = parseChangeLog({
        text: "## 1.0.0\n\n### Fixed\n\n- <em>trusted</em><script>alert(1)</script>",
        outputFormat: "html",
      });
      expect(changeLog.versions[0].changes[0].body).toBe(
        "<em>trusted</em><script>alert(1)</script>",
      );
    });
  });

  test("collects changes from every top-level list in a category", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Fixed",
        "- first",
        "Context between lists.",
        "- second",
        "",
        "1. third",
      ].join("\n\n"),
      outputFormat: "text",
    });

    expect(changeLog.versions[0].categories.Fixed).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("sorts unknown categories after the configured categories", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Custom First",
        "- custom first",
        "### Fixed",
        "- fixed",
        "### Added",
        "- added",
        "### Custom Second",
        "- custom second",
      ].join("\n\n"),
      outputFormat: "text",
    });

    expect(changeLog.versions[0].changes.map(({ type }) => type)).toEqual([
      "Added",
      "Fixed",
      "Custom First",
      "Custom Second",
    ]);
  });

  test("ignores duplicate categories in the configured order", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Custom",
        "- custom",
        "### Fixed",
        "- fixed",
        "### Added",
        "- added",
      ].join("\n\n"),
      categorySortOrder: ["Fixed", "Fixed", "Added"],
      outputFormat: "text",
    });

    expect(changeLog.versions[0].changes.map(({ type }) => type)).toEqual([
      "Fixed",
      "Added",
      "Custom",
    ]);
  });

  test("obeys options.defaultTitle", () => {
    let changeLog = parseChangeLog({
      text: "# Markdown Title",
      defaultTitle: "Test",
    });
    expect(changeLog).toHaveProperty("title", "Markdown Title");

    changeLog = parseChangeLog({ text: "" });
    expect(changeLog).toHaveProperty("title", "Release Notes");

    changeLog = parseChangeLog({ text: "", defaultTitle: "Test" });
    expect(changeLog).toHaveProperty("title", "Test");
  });

  test("obeys options.omitUnreleasedVersions", () => {
    let changeLog = parseChangeLog({ text });
    expect(changeLog.versions[0].title).toBe("[1.1.8] - 2021-10-28");

    changeLog = parseChangeLog({ text, omitUnreleasedVersions: true });
    expect(changeLog.versions[0].title).toBe("[1.1.8] - 2021-10-28");

    changeLog = parseChangeLog({ text, omitUnreleasedVersions: false });
    expect(changeLog.versions[0].title).toBe("Unreleased");
  });

  test("uses defaults for options that are explicitly undefined", () => {
    const changeLog = parseChangeLog({
      text: [
        "## Unreleased",
        "Added:",
        "- future",
        "## 1.0.0",
        "Fixed:",
        "- fixed",
        "Added:",
        "- added",
      ].join("\n\n"),
      categorySortOrder: undefined,
      defaultTitle: undefined,
      omitUnreleasedVersions: undefined,
      outputFormat: undefined,
      recognizeColonSections: undefined,
    });

    expect(changeLog.title).toBe("Release Notes");
    expect(changeLog.versions).toHaveLength(1);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Added", body: "added" },
      { type: "Fixed", body: "fixed" },
    ]);
  });

  test("does not recognize colon sections inside fenced code", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n\n```text\nAdded:\n```",
    });
    expect(changeLog.versions[0].body).toContain("Added:");
    expect(changeLog.versions[0].body).not.toContain("### Added");
  });
});
