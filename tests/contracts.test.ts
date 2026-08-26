import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import parseChangeLog, { type Options } from "../src";

describe("parser contracts", () => {
  test("file and text inputs are equivalent", () => {
    const filePath = `${__dirname}/testdata/CHANGELOG.md`;
    const text = fs.readFileSync(filePath, "utf8");
    expect(parseChangeLog({ filePath })).toEqual(parseChangeLog({ text }));
    expect(parseChangeLog(filePath)).toEqual(parseChangeLog({ text }));
  });

  test("rejects options without an input", () => {
    expect(() => parseChangeLog({} as Options)).toThrow(
      new TypeError("Expected either text or filePath"),
    );
  });

  test("recognizes colon sections without blank lines", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "Fixed:",
        "Context before the list.",
        "- fixed",
        "Added:",
        "- added",
      ].join("\n"),
      categorySortOrder: null,
      outputFormat: "text",
    });

    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: "fixed" },
      { type: "Added", body: "added" },
    ]);
    expect(changeLog.versions[0].body).toContain("Context before the list.");
  });

  test("recognizes colon sections without case sensitivity", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\nfixed:\n- fixed\nADDED:\n- added",
      categorySortOrder: null,
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "fixed", body: "fixed" },
      { type: "ADDED", body: "added" },
    ]);
  });

  test("keeps opaque Markdown regions out of the section structure", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "```markdown\n## 2.0.0\nAdded:\n- fenced\n```",
        "> ## 3.0.0\n> Added:\n> - quoted",
        "<div>\nAdded:\n- raw HTML\n</div>",
        "### Fixed\n- actual",
      ].join("\n\n"),
      outputFormat: "text",
    });

    expect(changeLog.versions).toHaveLength(1);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: "actual" },
    ]);
    expect(changeLog.versions[0].body).toContain("Added:");
    expect(changeLog.versions[0].body).not.toContain("### Added");
  });

  test("does not rewrite colon sections inside inline opaque regions", () => {
    for (const opaqueRegion of [
      "text `before\nAdded:\nafter`",
      "text <!-- before\nAdded:\nafter -->",
      "text <![CDATA[before\nAdded:\nafter]]>",
      "text <?before\nAdded:\nafter?>",
    ]) {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n${opaqueRegion}\n### Fixed\n- actual`,
        outputFormat: "text",
      });
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: "actual" },
      ]);
      expect(changeLog.versions[0].body).toContain("Added:");
      expect(changeLog.versions[0].body).not.toContain("<h3>Added</h3>");
    }
  });

  test("checks mixed opaque ranges in source order", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "text `before",
        "Added:",
        "after`",
        "text <!-- before",
        "Fixed:",
        "after -->",
        "### Security",
        "- actual",
      ].join("\n"),
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Security", body: "actual" },
    ]);
  });

  test.each(["pre", "code", "kbd", "script", "style", "textarea", "math"])(
    "does not rewrite colon sections inside <%s> regions",
    (tag) => {
      const changeLog = parseChangeLog({
        text: [
          "## 1.0.0",
          `text <${tag}>before`,
          "Added:",
          "- hidden",
          `after</${tag}>`,
          "### Fixed",
          "- actual",
        ].join("\n"),
        outputFormat: "text",
      });

      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: "actual" },
      ]);
      expect(changeLog.versions[0].body).toContain("Added:");
      expect(changeLog.versions[0].body).not.toContain("<h3>Added</h3>");
    },
  );

  test("matches literal HTML tag names and syntax precisely", () => {
    const protectedRegion = parseChangeLog({
      text: [
        "## 1.0.0",
        'text <STYLE media="screen > print">before',
        "Added:",
        "- hidden",
        "after</STYLE >",
        "### Fixed",
        "- actual",
      ].join("\n"),
      outputFormat: "text",
    });
    expect(protectedRegion.versions[0].changes).toEqual([
      { type: "Fixed", body: "actual" },
    ]);

    for (const tag of ["stylesheet", "style/"]) {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\ntext <${tag}>\nAdded:\n- actual`,
        outputFormat: "text",
      });
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Added", body: "actual" },
      ]);
    }

    const escapedTag = parseChangeLog({
      text: "## 1.0.0\nExplain \\<style> here.\nAdded:\n- actual",
      outputFormat: "text",
    });
    expect(escapedTag.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);

    for (const opener of ["\\<!--", "\\<![CDATA[", "\\<?"]) {
      const escapedDelimiter = parseChangeLog({
        text: `## 1.0.0\nExplain ${opener} here.\nAdded:\n- actual`,
        outputFormat: "text",
      });
      expect(escapedDelimiter.versions[0].changes).toEqual([
        { type: "Added", body: "actual" },
      ]);
    }

    const tagInCode = parseChangeLog({
      text: "## 1.0.0\n`<style>`\nAdded:\n- actual",
      outputFormat: "text",
    });
    expect(tagInCode.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);

    const tagInAttribute = parseChangeLog({
      text: '## 1.0.0\n<span title="<style>">text</span>\nAdded:\n- actual',
      outputFormat: "text",
    });
    expect(tagInAttribute.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);

    for (const markdown of [
      '[link](url "<style>")',
      '![image](url "<code>")',
    ]) {
      const tagInTitle = parseChangeLog({
        text: `## 1.0.0\n${markdown}\nAdded:\n- actual`,
        outputFormat: "text",
      });
      expect(tagInTitle.versions[0].changes).toEqual([
        { type: "Added", body: "actual" },
      ]);
    }
  });

  test("escaped backticks do not hide colon sections", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\ntext \\`\nAdded:\ntext \\`\n- actual",
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);
  });

  test.each([
    ["code spans", "before `", "after `"],
    ["links", "before [", "after](url)"],
  ])(
    "does not pair unmatched %s across Markdown blocks",
    (_, before, after) => {
      const changeLog = parseChangeLog({
        text: ["## 1.0.0", before, "Added:", "- actual", after].join("\n\n"),
        outputFormat: "text",
      });
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Added", body: "actual" },
      ]);
    },
  );

  test.each(["code", "kbd", "math"])(
    "preserves nested literal elements and malformed text inside <%s>",
    (outerTag) => {
      for (const innerTag of ["code", "kbd", "math"]) {
        for (const malformed of ["<!--", "<![CDATA["]) {
          const raw = `<${outerTag}><${innerTag}>x</${innerTag}>${malformed}</${outerTag}>`;
          const source = `## 1.0.0\n### Fixed\n- ${raw}`;
          const html = parseChangeLog({
            text: source,
            outputFormat: "html",
            recognizeColonSections: false,
          });
          const markdown = parseChangeLog({
            text: source,
            outputFormat: "markdown",
            recognizeColonSections: false,
          });
          const text = parseChangeLog({
            text: source,
            outputFormat: "text",
            recognizeColonSections: false,
          });

          expect(html.versions[0].changes[0].body).toBe(raw);
          expect(markdown.versions[0].changes[0].body).toBe(raw);
          expect(text.versions[0].changes[0].body).toBe(`x${malformed}`);
        }
      }
    },
  );

  test.each([
    ["comment", "<!-- x", "y -->", "&lt;!-- x"],
    ["CDATA", "<![CDATA[x", "y ]]>", "&lt;![CDATA[x"],
  ])(
    "does not carry a delimiter into a deeper quote after a %s",
    (_, opener, closer, escaped) => {
      const changeLog = parseChangeLog({
        text: `## 1\n### Fixed\n> - ${opener}\n> > ${closer}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].body).toContain(escaped);
      expect(changeLog.versions[0].body).not.toContain(`${opener}\n${closer}`);
    },
  );

  test.each([
    ["bullet", "> - <!-- x\n> - > y -->"],
    ["ordered", "> - <!-- x\n> 2. > y -->"],
    ["heading", "> - <!-- x\n> ### y -->"],
    ["raw HTML block", "> - <!-- x\n> <div>y --></div>"],
  ])("does not carry a delimiter into a sibling %s item", (_, text) => {
    const changeLog = parseChangeLog({
      text: `## 1\n### Fixed\n${text}\n### Added\n- actual`,
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
    expect(changeLog.versions[0].body).not.toContain("&lt;!&#8211; x");
  });

  test("preserves a hard-block-looking lazy continuation with required indentation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>   # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x\n# y -->");
  });

  test("caps ordered-list continuation indentation after extra marker spaces", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> 1.   <!-- x\n>     # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x\n    # y -->");
  });

  test("accepts a tab-expanded ordered-list continuation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> 1. <!-- x\n> \t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x\n # y -->");
  });

  test("rejects a one-column-short list continuation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>  # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
  });

  test("rejects a bare tab after a quote", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>\t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
  });

  test("accepts space-plus-tab after ordered marker padding", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> 1.  <!-- x\n> \t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test("accepts nested space-plus-tab continuation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - - <!-- x\n>  \t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test("rejects a short depth-three tab continuation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - - - <!-- x\n> \t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
  });

  test("accepts a tab followed by continuation spaces", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>\t  # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test("rejects a tab followed by one space", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>\t # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
  });

  test("accepts two tabs as continuation indentation", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>\t\t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test("rejects tab-spaces at nested list depth", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - - <!-- x\n>\t  # y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("&lt;!-- x");
  });

  test("accepts three tabs at list depth one", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - <!-- x\n>\t\t\t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test("accepts three tabs at list depth three", () => {
    const changeLog = parseChangeLog({
      text: "## 1\n### Fixed\n> - - - <!-- x\n>\t\t\t# y -->",
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].body).toContain("<!-- x");
  });

  test.each([
    ["nested bullet list", "> - ", "  > "],
    ["nested ordered list", "> 1. ", "  > "],
    ["list then quote then bullet", "- > - ", "  > "],
    ["list then quote then ordered", "- > 1. ", "  > "],
  ])(
    "accepts a lazy nested-list continuation after a %s",
    (_, openingPrefix, continuationPrefix) => {
      for (const [opener, closer] of [
        ["<!--", "-->"],
        ["<![CDATA[", "]]>"],
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1\n### Fixed\n${openingPrefix}${opener} x\n${continuationPrefix}y ${closer}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].body).toContain(
          `${opener} x\ny ${closer}`,
        );
        expect(changeLog.versions[0].body).not.toContain("&lt;!");
      }
    },
  );

  test.each([
    ["double quotes", '<span data-x="a > b">raw</span>'],
    ["single quotes", "<span data-x='a > b'>raw</span>"],
    ["comment-like attribute data", '<span data-x="<!--">raw</span>'],
    ["CDATA-like attribute data", '<span data-x="<![CDATA[">raw</span>'],
    ["self-closing quoted attribute", '<img data-x="a > b" />'],
  ])("preserves raw HTML with %s around greater-than signs", (_, html) => {
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n\n${html}\n\n### Fixed\n\n- ${html}`,
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].body).toContain(html);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: html },
    ]);
  });

  test("preserves multiple quote-bearing raw tags", () => {
    const first = '<span title="a > b">first</span>';
    const second = '<span title="c > d">second</span>';
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- ${first} and ${second}`,
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: `${first} and ${second}` },
    ]);
    expect(changeLog.versions[0].body).toContain(`${first} and ${second}`);
  });

  test("avoids delimiter sentinels already present in source", () => {
    const occupied = String.fromCharCode(0xe000, 0xe001, 0xe002);
    const changeLog = parseChangeLog({
      text: `# ${occupied} <!-- title\n## 1.0.0\n### Fixed\n- ${occupied} <![CDATA[ body`,
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.title).toBe(`${occupied} <!-- title`);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: `${occupied} &lt;![CDATA[ body` },
    ]);
  });

  test.each([
    ["escaped comment", "\\<!-- literal", "&lt;!&#8211; literal"],
    ["escaped CDATA", "\\<![CDATA[ literal", "&lt;![CDATA[ literal"],
    ["even comment escape", "\\\\<!-- malformed", "\\&lt;!-- malformed"],
    [
      "even CDATA escape",
      "\\\\<![CDATA[ malformed",
      "\\&lt;![CDATA[ malformed",
    ],
  ])("handles %s opener parity", (_, source, expected) => {
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- ${source}`,
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: expected },
    ]);
  });

  test.each([
    ["comment", "<!-- open", "<!-- complete -->", "&lt;!-- open"],
    ["CDATA", "<![CDATA[ open", "<![CDATA[complete]]>", "&lt;![CDATA[ open"],
  ])(
    "keeps an earlier malformed %s independent from a later complete delimiter",
    (_, malformed, complete, escaped) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- first ${malformed}\n- second ${complete}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });
      expect(changeLog.versions[0].changes[0].body).toBe(`first ${escaped}`);
      expect(changeLog.versions[0].changes[1].body).toBe(`second ${complete}`);
    },
  );

  test.each([
    ["comment", "<!-- open", "close -->", "&lt;!-- open"],
    ["CDATA", "<![CDATA[ open", "close ]]>", "&lt;![CDATA[ open"],
  ])(
    "keeps an earlier malformed %s independent from a later bare closer",
    (_, malformed, closer, escaped) => {
      for (const laterBlock of [
        `- second ${closer}`,
        `\nsecond ${closer}`,
        `> second ${closer}`,
        `<div>\nsecond ${closer}\n</div>`,
        `---\nsecond ${closer}`,
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- first ${malformed}\n${laterBlock}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });
        expect(changeLog.versions[0].changes[0].body).toBe(`first ${escaped}`);
      }
    },
  );

  test.each(["style", "code"])(
    "ends unclosed inline <%s> opacity at a blank-line boundary",
    (tag) => {
      const changeLog = parseChangeLog({
        text: ["## 1.0.0", `text <${tag}>before`, "Added:", "- actual"].join(
          "\n\n",
        ),
        outputFormat: "text",
      });
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Added", body: "actual" },
      ]);
    },
  );

  test.each([
    ["code span", "`</code>`"],
    ["link title", '[link](url "</code>")'],
    ["HTML attribute", '<span title="</code>">text</span>'],
  ])("does not close literal HTML from a %s", (_, falseCloser) => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        `text <code>before ${falseCloser}`,
        "Added:",
        "- hidden",
        "### Fixed",
        "- actual",
      ].join("\n"),
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: "actual" },
    ]);
  });

  test("handles many alternating opaque ranges and colon sections", () => {
    const pairs = Array.from(
      { length: 200 },
      (_, index) => `\`code-${index}\`\nAdded:`,
    );
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n${pairs.join("\n")}\n- actual`,
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Added", body: "actual" },
    ]);
  });

  test("supports setext headings and CRLF input", () => {
    const changeLog = parseChangeLog({
      text: [
        "Release Notes",
        "=============",
        "",
        "1.0.0 - 02/29/2000",
        "------------------",
        "",
        "Fixed:",
        "- item",
      ].join("\r\n"),
      outputFormat: "text",
    });

    expect(changeLog.title).toBe("Release Notes");
    expect(changeLog.versions[0]).toMatchObject({
      version: "1.0.0",
      date: "2000-02-29",
      changes: [{ type: "Fixed", body: "item" }],
    });
  });

  test("does not recognize colon sections when the option is false", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n\nFixed:\n\n- item",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].changes).toEqual([]);
    expect(changeLog.versions[0].body).toContain("Fixed:");
  });

  test("keeps nested lists within one change", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n\n### Fixed\n\n- outer\n  - inner one\n  - inner two",
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: "outer\ninner one\ninner two" },
    ]);
  });

  test("renders all inline constructs as text without changing code", () => {
    const changeLog = parseChangeLog({
      text: [
        '# <span title="x > y">Release Notes</span>',
        "## 1.0.0",
        "### Fixed",
        '- **strong** *emphasis* ~~deleted~~ [link](/url) ![image](/image) prose -- "quote" and `code -- "quote"` and `&amp;`',
        '- raw <code>&amp; -- "quote"</code> and <kbd>key -- "quote"</kbd>',
        "- before <!-- don't expose this --> after",
      ].join("\n\n"),
      outputFormat: "text",
    });

    expect(changeLog.title).toBe("Release Notes");
    expect(changeLog.versions[0].changes[0].body).toBe(
      'strong emphasis deleted link image prose – “quote” and code -- "quote" and &amp;',
    );
    expect(changeLog.versions[0].changes[1].body).toBe(
      'raw & -- "quote" and key -- "quote"',
    );
    expect(changeLog.versions[0].changes[2].body).toBe("before  after");
  });

  test("preserves block-code punctuation in text output", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Fixed",
        "- prose",
        "",
        '      code -- "quote"',
      ].join("\n"),
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes[0].body).toBe(
      'prose\n\ncode -- "quote"',
    );
  });

  test("renders tables inside changes as text", () => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Fixed",
        "- summary",
        "",
        "  | A | B |",
        "  | - | - |",
        "  | one | two |",
      ].join("\n"),
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes[0].body).toBe(
      "summary\n\nA B one two",
    );
  });

  test.each([
    ["2024-02-29", "2024-02-29"],
    ["02/29/2000", "2000-02-29"],
    ["02/29/0000", "0000-02-29"],
    ["12/31/60", "2060-12-31"],
    ["01/01/61", "1961-01-01"],
    ["2023-02-29", "2023-02-29"],
    ["13/01/2024", "13/01/2024"],
    ["01-02/2024", "01-02/2024"],
  ])("normalizes or preserves date %s", (source, expected) => {
    const changeLog = parseChangeLog({ text: `## 1.0.0 - ${source}` });
    expect(changeLog.versions[0].date).toBe(expected);
  });

  test.each([
    ["1", "1"],
    ["1.2", "1.2"],
    ["[1.2.3]", "1.2.3"],
    ["[1.2.3-beta.1+build]", "1.2.3-beta.1+build"],
    ["v1.2.3", null],
    ["1.2.3.4", null],
  ])("extracts supported version title %s", (source, expected) => {
    const changeLog = parseChangeLog({ text: `## ${source}` });
    expect(changeLog.versions[0].version).toBe(expected);
  });

  test("recognizes all supported date separators", () => {
    for (const separator of [" - ", " -- ", " – ", "—"]) {
      const changeLog = parseChangeLog({
        text: `## [1.2.3]${separator}2024-02-29`,
      });
      expect(changeLog.versions[0]).toMatchObject({
        version: "1.2.3",
        date: "2024-02-29",
      });
    }
  });

  test("disabling category sorting preserves source order", () => {
    const changeLog = parseChangeLog({
      text: ["## 1.0.0", "### Fixed", "- fixed", "### Added", "- added"].join(
        "\n\n",
      ),
      categorySortOrder: null,
      outputFormat: "text",
    });
    expect(changeLog.versions[0].changes.map(({ type }) => type)).toEqual([
      "Fixed",
      "Added",
    ]);
  });

  test.each(["Unreleased", "unreleased", "[UNRELEASED]"])(
    "omits unreleased title %s without case sensitivity",
    (title) => {
      const changeLog = parseChangeLog({ text: `## ${title}` });
      expect(changeLog.versions).toEqual([]);
    },
  );

  test("supports every problematic object property as a category", () => {
    const names = [
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "prototype",
      "toString",
    ];
    const text = [
      "## 1.0.0",
      ...names.flatMap((name) => [`### \`${name}\``, `- \`${name}\``]),
    ].join("\n\n");
    const categories = parseChangeLog({ text, outputFormat: "text" })
      .versions[0].categories;

    for (const name of names) expect(categories[name]).toEqual([name]);
    expect(Object.keys(categories)).toEqual(names);
    const absent: string[] | undefined = categories.Security;
    expect(absent).toBeUndefined();
  });

  test("returns a well-typed empty result for malformed Markdown", () => {
    for (const text of ["", "\0", "```", "<div", "##", "- - - -"]) {
      const changeLog = parseChangeLog({ text });
      assert.equal(typeof changeLog.title, "string");
      assert.ok(Array.isArray(changeLog.versions));
    }
  });

  test.each([
    ["comment", "before <!-- hidden --> after", "before  after"],
    ["CDATA", "before <![CDATA[hidden]]> after", "before  after"],
    ["processing instruction", "before <?target data?> after", "before  after"],
    ["declaration", "before <!DOCTYPE html> after", "before  after"],
    [
      "double-quoted greater-than sign",
      'before <span title=" > ">inside</span> after',
      "before inside after",
    ],
    [
      "single-quoted greater-than sign",
      "before <span title=' > '>inside</span> after",
      "before inside after",
    ],
    ["non-tag digit", "before <1 after", "before <1 after"],
    ["non-tag punctuation", "before <. after", "before <. after"],
  ])(
    "strips a complete %s without losing adjacent text",
    (_, source, expected) => {
      const changeLog = parseChangeLog({
        text: `# ${source}\n## 1.0.0\n### Fixed\n- ${source}`,
        outputFormat: "text",
        recognizeColonSections: false,
      });
      expect(changeLog.title).toBe(expected);
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: expected },
      ]);
    },
  );

  test("preserves many unterminated HTML tag starts", () => {
    const malformed = "<a ".repeat(2_000);
    const titleResult = parseChangeLog({
      text: `# ${malformed}`,
      recognizeColonSections: false,
    });
    const changeResult = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- ${malformed}`,
      outputFormat: "text",
      recognizeColonSections: false,
    });

    expect(titleResult.title).toBe(malformed.trim());
    expect(changeResult.versions[0].changes).toEqual([
      { type: "Fixed", body: malformed.trim() },
    ]);
  });

  test.each([
    ["emphasis", "prefix <a", "**bold**", "prefix <a bold"],
    ["link", "prefix <a", "[link](/url)", "prefix <a link"],
    ["code", "prefix <a", "`code`", "prefix <a code"],
    [
      "comment-like text",
      "prefix <!-- open",
      "**bold**",
      "prefix <!-- open bold",
    ],
  ])("parses %s after malformed HTML", (_, prefix, markdown, expected) => {
    const changeLog = parseChangeLog({
      text: `# ${prefix} ${markdown}\n## 1.0.0\n### Fixed\n- ${prefix} ${markdown}`,
      outputFormat: "text",
      recognizeColonSections: false,
    });
    expect(changeLog.title).toBe(expected);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: expected },
    ]);
  });

  test.each([
    ["closing tag", "prefix </a", "**bold**", "prefix </a bold"],
    ["declaration", "prefix <!thing", "**bold**", "prefix <!thing bold"],
    [
      "processing instruction",
      "prefix <?target",
      "**bold**",
      "prefix <?target bold",
    ],
    ["underscore emphasis", "prefix <a", "_italic_", "prefix <a italic"],
    ["image", "prefix <a", "![image](/image)", "prefix <a image"],
    [
      "angle-bracket autolink",
      "prefix <a",
      "<https://example.com>",
      "prefix <a https://example.com",
    ],
  ])(
    "recovers %s syntax after malformed HTML",
    (_, prefix, markdown, expected) => {
      const changeLog = parseChangeLog({
        text: `# ${prefix} ${markdown}\n## 1.0.0\n### Fixed\n- ${prefix} ${markdown}`,
        outputFormat: "text",
        recognizeColonSections: false,
      });
      expect(changeLog.title).toBe(expected);
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: expected },
      ]);
    },
  );

  test.each(["\n", "\r\n"])(
    "parses a hard break after malformed HTML with %j",
    (newline) => {
      const changeLog = parseChangeLog({
        text: ["## 1.0.0", "### Fixed", `- before <a  ${newline}  after`].join(
          newline,
        ),
        outputFormat: "html",
        recognizeColonSections: false,
      });
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: "before &lt;a<br>after" },
      ]);
    },
  );

  test.each([
    [
      "https://example.com",
      '<a href="https://example.com">https://example.com</a>',
    ],
    [
      "http://example.com",
      '<a href="http://example.com">http://example.com</a>',
    ],
    [
      "HTTPS://example.com",
      '<a href="HTTPS://example.com">HTTPS://example.com</a>',
    ],
    ["www.example.com", '<a href="http://www.example.com">www.example.com</a>'],
    [
      "(https://example.com)",
      '(<a href="https://example.com">https://example.com</a>)',
    ],
    [
      "user@example.com",
      '<a href="mailto:user@example.com">user@example.com</a>',
    ],
    [
      "foo+bar@example.co.uk",
      '<a href="mailto:foo+bar@example.co.uk">foo+bar@example.co.uk</a>',
    ],
  ])("parses GFM autolink %s after malformed HTML", (url, renderedURL) => {
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- before <a visit ${url}`,
      outputFormat: "html",
      recognizeColonSections: false,
    });
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: `before &lt;a visit ${renderedURL}` },
    ]);
  });

  test.each([
    ["x@! then ", "user@example.com"],
    ["x@domain! then ", "user@example.com"],
    ["x@domain.! then ", "user@example.com"],
    ["x@domain.-! then ", "foo+bar@example.co.uk"],
  ])(
    "finds a valid email after malformed candidate %j",
    (invalidCandidate, email) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- before <a ${invalidCandidate}${email}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });
      expect(changeLog.versions[0].changes).toEqual([
        {
          type: "Fixed",
          body: `before &lt;a ${invalidCandidate}<a href="mailto:${email}">${email}</a>`,
        },
      ]);
    },
  );

  test.each(["<!--", "<![CDATA["])(
    "recovers Markdown after repeated unterminated %s openers",
    (opener) => {
      const malformed = `${opener} one ${opener} two`;
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- before ${malformed} **bold**`,
        outputFormat: "html",
        recognizeColonSections: false,
      });
      expect(changeLog.versions[0].changes).toEqual([
        {
          type: "Fixed",
          body: `before ${
            opener === "<!--"
              ? malformed.replaceAll("<!--", "&lt;!--")
              : malformed.replaceAll("<", "&lt;")
          } <strong>bold</strong>`,
        },
      ]);
    },
  );

  test.each([
    ["comment", "<!--", "&lt;!--"],
    ["CDATA", "<![CDATA[", "&lt;![CDATA["],
  ])("escapes an unterminated %s at block boundaries", (_, opener, escaped) => {
    const changeLog = parseChangeLog({
      text: [
        "## 1.0.0",
        "### Fixed",
        `- ${opener} list`,
        "",
        `> ${opener} quote`,
      ].join("\n"),
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].body).toContain(`${escaped} list`);
    expect(changeLog.versions[0].body).toContain(`${escaped} quote`);
    expect(changeLog.versions[0].body).not.toContain(opener);
    expect(changeLog.versions[0].changes).toEqual([
      { type: "Fixed", body: `${escaped} list` },
    ]);
  });

  test.each([
    ["comment", "<!-- complete", "across -->"],
    ["CDATA", "<![CDATA[complete", "across]]>"],
  ])("preserves a complete multiline %s", (_, opener, closer) => {
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- before ${opener}\n  ${closer} after`,
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].body).toContain(opener);
    expect(changeLog.versions[0].body).toContain(closer);
    expect(changeLog.versions[0].changes[0].body).toContain(opener);
    expect(changeLog.versions[0].changes[0].body).toContain(closer);
  });

  test.each([
    ["comment", "<!-- complete", "across -->"],
    ["CDATA", "<![CDATA[complete", "across]]>"],
  ])(
    "preserves a block-start %s across Markdown-looking boundaries",
    (_, opener, closer) => {
      const delimiter = `${opener}\n### heading-like\n- list-like\n<div>html-like</div>\n${closer}`;
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n${delimiter}\n### Fixed\n- actual`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].body).toContain(delimiter);
      expect(changeLog.versions[0].changes).toEqual([
        { type: "Fixed", body: "actual" },
      ]);
    },
  );

  test.each([
    ["comment", "<!-- open", "close -->"],
    ["CDATA", "<![CDATA[open", "close]]>"],
  ])(
    "preserves a list-item block-start %s across Markdown-looking lines",
    (_, opener, closer) => {
      for (const marker of ["-", "1."]) {
        const raw = `${opener}\n### heading-like\n${closer}`;
        const continuation = " ".repeat(marker.length + 1);
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n${marker} ${opener}\n${continuation}### heading-like\n${continuation}${closer}\n${marker} actual`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(raw);
        expect(changeLog.versions[0].changes[1].body).toBe("actual");
      }
    },
  );

  test.each([
    ["list then quote", "- > ", "  > ", ""],
    ["tab-separated list then quote", "-\t>\t", "\t>\t", "   "],
    ["ordered list then quote", "1. > ", "   > ", ""],
    ["quote then list", "> - ", ">   ", ""],
    ["list then quote then list", "- > - ", "  >   ", ""],
  ])(
    "preserves delimiters across a %s container prefix",
    (_, openingPrefix, continuationPrefix, renderedIndent) => {
      for (const [opener, closer] of [
        ["<!--", "-->"],
        ["<![CDATA[", "]]>"],
      ]) {
        const raw = `${opener} x\n${renderedIndent}y ${closer}`;
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n${openingPrefix}${opener} x\n${continuationPrefix}y ${closer}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].body).toContain(raw);
        expect(changeLog.versions[0].body).not.toContain("&lt;!");
      }
    },
  );

  test.each([
    ["comment", "<!--", "-->", "&lt;!--"],
    ["CDATA", "<![CDATA[", "]]>", "&lt;![CDATA["],
  ])(
    "does not let a noninterrupting ordered marker capture a later %s closer",
    (_, opener, closer, escapedOpener) => {
      const changeLog = parseChangeLog({
        text: `## 1\n### Fixed\nparagraph\n2. > ${opener} open\n### Added\n- added\n${closer}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].body).toContain(
        `2. > ${escapedOpener} open`,
      );
    },
  );

  test.each([
    ["list", "- "],
    ["list then quote", "- > "],
    ["tab-separated list then quote", "-\t>\t"],
    ["ordered list then quote", "1. > "],
    ["quote then list", "> - "],
    ["list then quote then list", "- > - "],
  ])(
    "does not carry a block-start delimiter outside a %s container",
    (_, openingPrefix) => {
      for (const [opener, closer, escapedOpener] of [
        ["<!--", "-->", "&lt;!--"],
        ["<![CDATA[", "]]>", "&lt;![CDATA["],
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1\n### Fixed\n${openingPrefix}${opener} open\n### Added\n- added\n${closer}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].body).toContain(`${escapedOpener} open`);
        expect(changeLog.versions[0].body).not.toContain(`${opener} open`);
      }
    },
  );

  test.each([
    ["space list prefix and tab continuation", "- > ", "\t> "],
    ["tab list prefix and space continuation", "-\t>\t", "    > "],
    ["ordered list prefix and tab continuation", "1. > ", "\t> "],
    ["quote-list prefix and tab continuation", "> - ", ">\t"],
  ])(
    "accepts equivalent container indentation for a %s",
    (_, openingPrefix, continuationPrefix) => {
      for (const [opener, closer] of [
        ["<!--", "-->"],
        ["<![CDATA[", "]]>"],
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1\n### Fixed\n${openingPrefix}${opener} x\n${continuationPrefix}y ${closer}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].body).toContain(opener);
        expect(changeLog.versions[0].body).not.toContain("&lt;!");
      }
    },
  );

  test.each([
    ["comment", "<!-- x", "y -->"],
    ["CDATA", "<![CDATA[x", "y ]]>"],
  ])(
    "preserves a complete %s across a lazy list-item continuation",
    (_, opener, closer) => {
      for (const newline of ["\n", "\r\n"]) {
        for (const marker of ["-", "1."]) {
          const sourceRaw = `${opener}${newline}${closer}`;
          const renderedRaw = `${opener}\n${closer}`;
          const changeLog = parseChangeLog({
            text: `## 1${newline}### Fixed${newline}${marker} ${sourceRaw}`,
            outputFormat: "html",
            recognizeColonSections: false,
          });

          expect(changeLog.versions[0].body).toContain(renderedRaw);
          expect(changeLog.versions[0].changes[0].body).toBe(renderedRaw);
        }
      }
    },
  );

  test.each([
    ["comment", "<!-- x", "y -->", "&lt;!-- x"],
    ["CDATA", "<![CDATA[x", "y ]]>", "&lt;![CDATA[x"],
  ])(
    "does not carry a lazy %s continuation through a blockquote",
    (_, opener, closer, escaped) => {
      const changeLog = parseChangeLog({
        text: `## 1\n### Fixed\n- > ${opener}\n${closer}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].body).toContain(escaped);
      expect(changeLog.versions[0].body).not.toContain(`${opener}\n${closer}`);
    },
  );

  test.each([
    ["comment", "<!-- x", "2. continuation -->"],
    ["CDATA", "<![CDATA[x", "2. continuation]]>"],
  ])(
    "keeps a complete inline %s across a noninterrupting ordered marker",
    (_, opener, closer) => {
      const raw = `${opener}\n${closer}`;
      const changeLog = parseChangeLog({
        text: `## 1\nparagraph ${raw}\n### Fixed\n- actual`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].body).toContain(raw);
    },
  );

  test.each(["style", "textarea"])(
    "preserves literal content inside raw <%s> elements",
    (tagName) => {
      const raw = `<${tagName}>"hello -- world"</${tagName}>`;
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${raw}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes[0].body).toBe(raw);
      expect(changeLog.versions[0].body).toContain(raw);
    },
  );

  test.each(["script", "style", "textarea", "pre", "code", "kbd", "math"])(
    "preserves malformed delimiter text inside complete raw <%s> elements",
    (tagName) => {
      for (const content of ["x <!-- y", "x <![CDATA[ y"]) {
        const raw = `<${tagName}>${content}</${tagName}>`;
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- ${raw}`,
          outputFormat: "html",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(raw);
        expect(changeLog.versions[0].body).toContain(raw);
      }
    },
  );

  test.each(["code", "kbd", "math"])(
    "renders malformed delimiter text inside complete inline <%s> elements as text",
    (tagName) => {
      for (const content of ["x <!-- y", "x <![CDATA[ y"]) {
        const raw = `<${tagName}>${content}</${tagName}>`;
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- ${raw}`,
          outputFormat: "text",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(content);
      }
    },
  );

  test.each(["code", "kbd", "math"])(
    "strips nested markup from malformed literal text inside <%s>",
    (tagName) => {
      for (const [content, expected] of [
        ["<b>&amp;</b> <!-- y", "& <!-- y"],
        ["<!-- y <b>bold</b>", "<!-- y bold"],
        ["<![CDATA[ y <i>italic</i>", "<![CDATA[ y italic"],
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- <${tagName} data-x=">">${content}</${tagName}>`,
          outputFormat: "text",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(expected);
      }
    },
  );

  test.each(["code", "kbd", "math"])(
    "preserves false closing tags inside Markdown syntax within <%s>",
    (tagName) => {
      for (const content of [
        `before \`</${tagName}>\` after`,
        `before \`\` \`</${tagName}>\` \`\` after`,
        `before [x](url "</${tagName}>") after`,
        `before [x](url_(nested) "</${tagName}>") after`,
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- <${tagName}>${content}</${tagName}>`,
          outputFormat: "text",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(content);
      }
    },
  );

  test.each([
    [
      "code span",
      "before `<code>` after </code>",
      "before <code>&lt;code&gt;</code> after </code>",
    ],
    [
      "link title",
      'before [x](url "<code>") after </code>',
      'before <a href="url" title="&lt;code&gt;">x</a> after </code>',
    ],
  ])(
    "does not open a literal element from a false tag in a %s",
    (_, source, expected) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${source}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes[0].body).toBe(expected);
    },
  );

  test("strips complete HTML comments from inline literal text", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n### Fixed\n- <code>before <!-- hidden --> after</code>",
      outputFormat: "text",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].changes[0].body).toBe("before  after");
  });

  test.each(["code", "kbd", "math"])(
    "keeps repeated malformed delimiters distinct inside <%s> text",
    (tagName) => {
      for (const [content, expected] of [
        ["<!-- malformed <!-- hidden --> <b>bold</b>", "<!-- malformed  bold"],
        [
          "<![CDATA[ malformed <![CDATA[ hidden]]> <b>bold</b>",
          "<![CDATA[ malformed  bold",
        ],
        ["<!-- hidden --> <!-- malformed", " <!-- malformed"],
        ["<![CDATA[hidden]]> <![CDATA[ malformed", " <![CDATA[ malformed"],
      ]) {
        const changeLog = parseChangeLog({
          text: `## 1.0.0\n### Fixed\n- <${tagName}>${content}</${tagName}>`,
          outputFormat: "text",
          recognizeColonSections: false,
        });

        expect(changeLog.versions[0].changes[0].body).toBe(expected);
      }
    },
  );

  test.each([
    ["comment", "<!-- x <![CDATA[ y -->"],
    ["CDATA", "<![CDATA[x <!-- y]]>"],
  ])("preserves alternating delimiter text inside a complete %s", (_, raw) => {
    const changeLog = parseChangeLog({
      text: `## 1.0.0\n### Fixed\n- ${raw}`,
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].changes[0].body).toBe(raw);
    expect(changeLog.versions[0].body).toContain(raw);
  });

  test.each([
    [
      "comment",
      "<!-- malformed <![CDATA[hidden]]>",
      "&lt;!-- malformed <![CDATA[hidden]]>",
    ],
    [
      "CDATA",
      "<![CDATA[ malformed <!-- hidden -->",
      "&lt;![CDATA[ malformed <!-- hidden -->",
    ],
  ])(
    "keeps a malformed %s distinct from an inner complete delimiter",
    (_, raw, expected) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${raw}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes[0].body).toBe(expected);
    },
  );

  test.each([
    ["comment", "<!-- one <!-- two --> -->", "&lt;!-- one <!-- two -->"],
    [
      "CDATA",
      "<![CDATA[one <![CDATA[two]]> ]]>",
      "&lt;![CDATA[one <![CDATA[two]]>",
    ],
    [
      "three comments",
      "<!-- one <!-- two <!-- three --> --> -->",
      "&lt;!-- one &lt;!-- two <!-- three -->",
    ],
  ])(
    "does not reclassify an earlier malformed %s after multiple closers",
    (_, raw, expectedPrefix) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- ${raw}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes[0].body).toStartWith(expectedPrefix);
    },
  );

  test("still escapes malformed delimiter text inside ordinary raw HTML", () => {
    const changeLog = parseChangeLog({
      text: "## 1.0.0\n### Fixed\n- <div>x <!-- y</div>",
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].changes[0].body).toBe(
      "<div>x &lt;!-- y</div>",
    );
  });

  test("keeps punctuation literal after an unclosed inline code tag", () => {
    const changeLog = parseChangeLog({
      text: '## 1.0.0\n### Fixed\n- <code>"hello -- world"',
      outputFormat: "text",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].changes[0].body).toBe('"hello -- world"');
  });

  test("still applies Smartypants to text inside ordinary raw HTML", () => {
    const changeLog = parseChangeLog({
      text: '## 1.0.0\n### Fixed\n- <div>"hello -- world"</div>',
      outputFormat: "html",
      recognizeColonSections: false,
    });

    expect(changeLog.versions[0].changes[0].body).toBe(
      "<div>&#8220;hello &#8211; world&#8221;</div>",
    );
  });

  test.each([
    ["comment", "<!-- malformed", "<!-- complete -->"],
    ["CDATA", "<![CDATA[malformed", "<![CDATA[complete]]>"],
  ])(
    "does not carry an unterminated %s scan across list items",
    (_, malformed, complete) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- first ${malformed}\n- second ${complete}`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes[1].body).toContain(complete);
      expect(changeLog.versions[0].body).toContain(complete);
    },
  );

  test.each([
    ["comment", "<!-- open", "&lt;!-- open"],
    ["CDATA", "<![CDATA[ open", "&lt;![CDATA[ open"],
  ])(
    "recovers Markdown after soft-wrapped malformed %s text",
    (_, malformed, escaped) => {
      const changeLog = parseChangeLog({
        text: `## 1.0.0\n### Fixed\n- before ${malformed}\n  continued\n  **bold** and [link](/url)`,
        outputFormat: "html",
        recognizeColonSections: false,
      });

      expect(changeLog.versions[0].changes).toEqual([
        {
          type: "Fixed",
          body: `before ${escaped}\ncontinued\n<strong>bold</strong> and <a href="/url">link</a>`,
        },
      ]);
    },
  );
});
