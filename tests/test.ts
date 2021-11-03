import fs from "fs";
import { parseChangeLog } from "../src";

describe("parseChangeLog", () => {
  const filePath = `${__dirname}/testdata/CHANGELOG.md`;
  const text = fs.readFileSync(filePath, "utf-8");

  test("parses a string", () => {
    const changeLog = parseChangeLog({ text });
    expect(changeLog).toHaveProperty("title");
  });

  test("parses a file", () => {
    const changeLog = parseChangeLog({ filePath });
    expect(changeLog).toHaveProperty("title");
  });

  const changeLog = parseChangeLog({ text });
  test("has a title", () => {
    expect(changeLog.title).toBe("Change Log");
  });

  test("has an array of versions", () => {
    expect(changeLog.versions).toBeInstanceOf(Array);
  });

  describe("version", () => {
    test("has a title", () => {
      expect(changeLog.versions[1].title).toBe("[1.1.8] - 2021-10-28");
    });
    test("has a version number", () => {
      expect(changeLog.versions[1].version).toBe("1.1.8");
    });
    test("has a date", () => {
      expect(changeLog.versions[1].date).toBe("October 28, 2021");
    });
    test("has an map of change types", () => {
      expect(changeLog.versions[1].changes).toBeInstanceOf(Array);
      expect(changeLog.versions[1].parsed).toBeInstanceOf(Object);
    });
  });
});
