import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { parseChangeLog } from "../dist/index.js";

const fixture = fs.readFileSync("tests/testdata/CHANGELOG.md", "utf8");
const requestedCopies = process.argv.slice(2).map(Number);
const copyCounts =
  requestedCopies.length > 0 ? requestedCopies : [1, 5, 10, 20];

for (const copies of copyCounts) {
  const text = Array(copies).fill(fixture).join("\n");
  for (let iteration = 0; iteration < 5; iteration += 1) {
    parseChangeLog({ text });
  }

  const samples = [];
  for (let iteration = 0; iteration < 9; iteration += 1) {
    const start = performance.now();
    parseChangeLog({ text });
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(
    `${copies}x\t${Buffer.byteLength(text)} bytes\t${median.toFixed(2)} ms`,
  );
}
