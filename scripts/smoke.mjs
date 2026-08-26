import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const commonJS = require("@osteele/changelog-parser");
const module = await import("@osteele/changelog-parser");

for (const [name, parser] of [
  ["CommonJS default", commonJS.default],
  ["CommonJS named", commonJS.parseChangeLog],
  ["ESM default", module.default],
  ["ESM named", module.parseChangeLog],
]) {
  assert.equal(typeof parser, "function", `${name} export`);
  assert.equal(
    parser({ text: "## 1.0.0 - 11/04/21" }).versions[0].date,
    "2021-11-04",
    `${name} parser`,
  );
}
