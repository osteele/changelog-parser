#!/usr/bin/env ts-node

import * as fs from "fs";
import * as pug from "pug";
import { parseChangeLog } from "../src";

const templatePath = `${__dirname}/changelog.pug`;

async function main(args: string[]) {
  assert(args.length === 1, "Expected exactly one argument");
  const filePath = args[0];
  const outfile = filePath.replace(/\.md$/, ".html");

  const changelog = parseChangeLog({ filePath });
  // console.info(changelog);
  const html = pug.renderFile(templatePath, changelog);
  fs.writeFileSync(outfile, html);
  process.stdout.write(`Wrote ${outfile}\n`);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

main(process.argv.slice(2));
