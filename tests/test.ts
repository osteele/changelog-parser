import fs from "fs";
import { parseChangeLog } from "../src";

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

  const changeLog = parseChangeLog({ text });

  test("has a title property", () => {
    expect(changeLog).toHaveProperty("title", "Change Log");
  });

  test("has an version property", () => {
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
      expect(changeLog.versions[0].date).toBe("October 28, 2021");
    });
    test("has an map of change types", () => {
      expect(changeLog.versions[0].changes).toBeInstanceOf(Array);
      expect(changeLog.versions[0].categories).toBeInstanceOf(Object);
    });
  });

  describe("changes", () => {
    test("parses multiple lines", () => {
      expect(changeLog.versions[0].changes[0].body.replace(/\n/g, " ")).toMatch(
        /to the library list/
      );
    });
    test("preserves links", () => {
      expect(changeLog.versions[0].changes[0].body).toContain("<a href=");
    });
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
});
