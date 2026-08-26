import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import parseChangeLog, { type ChangeLog } from "../src";

const defaultCategoryOrder = [
  "Added",
  "New",
  "Changed",
  "Improved",
  "Fixed",
  "Removed",
  "Security",
];

const categoryNames = [
  ...defaultCategoryOrder,
  "Custom",
  "__proto__",
  "constructor",
  "toString",
];

const malformedFragments = [
  "#",
  "##",
  "###",
  "- ",
  "1. ",
  "```",
  "~~~",
  "> ",
  "<div>",
  "</div>",
  "<!-- don't -->",
  "Added:",
  "Fixed:",
  "[",
  "]",
  "`",
  "&amp;",
  "text",
  "\n",
  "\r\n",
  "\0",
] as const;

const generatedModelFeatures = [
  "line-ending:lf",
  "line-ending:crlf",
  "unreleased:present",
  "unreleased:absent",
  "versions:single",
  "versions:multiple",
  "section:colon",
  "section:heading",
  "category-gap:blank",
  "category-gap:adjacent",
  "change-gap:blank",
  "change-gap:adjacent",
  "change-marker:bullet",
  "change-marker:ordered",
  ...categoryNames.map((name) => `category:${name}`),
] as const;

const propertySeed = readPropertySeed();

type GeneratedChange = { type: string; body: string };
type GeneratedVersion = {
  title: string;
  sourceChanges: GeneratedChange[];
};

type GeneratedChangeLog = {
  text: string;
  title: string;
  versions: GeneratedVersion[];
  features: Set<string>;
};

function readPropertySeed(): number | null {
  const value = process.env.PROPERTY_SEED;
  if (value === undefined) return null;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 1) {
    throw new TypeError(
      `PROPERTY_SEED must be a positive integer, got ${value}`,
    );
  }
  return seed;
}

function selectSeeds(maxSeed: number): number[] {
  return propertySeed === null
    ? Array.from({ length: maxSeed }, (_, index) => index + 1)
    : [propertySeed];
}

function shardSeeds(maxSeed: number, shardSize: number): number[][] {
  const seeds = selectSeeds(maxSeed);
  if (propertySeed !== null) return [seeds];
  return Array.from(
    { length: Math.ceil(seeds.length / shardSize) },
    (_, index) => seeds.slice(index * shardSize, (index + 1) * shardSize),
  );
}

function withSeedContext(
  campaign: string,
  seed: number,
  input: string,
  run: () => void,
): void {
  try {
    run();
  } catch (error) {
    const replay = `PROPERTY_SEED=${seed} bun test tests/properties.test.ts -t ${JSON.stringify(campaign)}`;
    const context = `\nSeed: ${seed}\nReplay: ${replay}\nInput: ${JSON.stringify(input)}`;
    if (error instanceof Error) {
      error.message += context;
      throw error;
    }
    throw new Error(`${String(error)}${context}`);
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function renderCategoryName(type: string): string {
  return type === "__proto__" ? `\`${type}\`` : type;
}

function generateChangeLog(seed: number): GeneratedChangeLog {
  const random = createRandom(seed);
  const lineEnding = seed % 2 === 0 ? "\r\n" : "\n";
  const features = new Set<string>([
    lineEnding === "\n" ? "line-ending:lf" : "line-ending:crlf",
  ]);
  const title = `Generated ${seed}`;
  const versionCount = 1 + Math.floor(random() * 4);
  features.add(versionCount === 1 ? "versions:single" : "versions:multiple");
  const versions: GeneratedVersion[] = [];
  const lines = [`# ${title}`, ""];

  const includeUnreleased = random() < 0.5;
  features.add(includeUnreleased ? "unreleased:present" : "unreleased:absent");
  if (includeUnreleased) {
    lines.push("## Unreleased", "", "### Added", "", "- future", "");
  }

  for (let versionIndex = 0; versionIndex < versionCount; versionIndex += 1) {
    const version = `1.${seed % 10}.${versionIndex}`;
    const date = `2024-${String((versionIndex % 12) + 1).padStart(2, "0")}-01`;
    const title = `[${version}] - ${date}`;
    const categoryCount = 1 + Math.floor(random() * 6);
    const sourceChanges: GeneratedChange[] = [];
    lines.push(`## ${title}`);

    for (
      let categoryIndex = 0;
      categoryIndex < categoryCount;
      categoryIndex += 1
    ) {
      const type = choose(random, categoryNames);
      features.add(`category:${type}`);
      const colonSection =
        defaultCategoryOrder.includes(type) && random() < 0.5;
      features.add(colonSection ? "section:colon" : "section:heading");
      const blankBeforeCategory = random() < 0.5;
      features.add(
        blankBeforeCategory ? "category-gap:blank" : "category-gap:adjacent",
      );
      if (blankBeforeCategory) lines.push("");
      lines.push(colonSection ? `${type}:` : `### ${renderCategoryName(type)}`);
      const changeCount = 1 + Math.floor(random() * 3);
      for (let changeIndex = 0; changeIndex < changeCount; changeIndex += 1) {
        const body = `change-${seed}-${versionIndex}-${categoryIndex}-${changeIndex}`;
        const marker = random() < 0.5 ? "-" : `${changeIndex + 1}.`;
        features.add(
          marker === "-" ? "change-marker:bullet" : "change-marker:ordered",
        );
        const blankBeforeChange = random() < 0.5;
        features.add(
          blankBeforeChange ? "change-gap:blank" : "change-gap:adjacent",
        );
        if (blankBeforeChange) lines.push("");
        lines.push(`${marker} ${body}`);
        sourceChanges.push({ type, body });
      }
    }
    lines.push("");
    versions.push({ title, sourceChanges });
  }

  return { text: lines.join(lineEnding), title, versions, features };
}

function generateMalformedInput(seed: number): {
  text: string;
  features: Set<string>;
} {
  const random = createRandom(seed);
  const count = 1 + Math.floor(random() * 80);
  const features = new Set<string>();
  let text = "";
  for (let index = 0; index < count; index += 1) {
    const fragment = choose(random, malformedFragments);
    features.add(fragment);
    text += fragment;
  }
  return { text, features };
}

function sortChanges(changes: readonly GeneratedChange[]): GeneratedChange[] {
  return [...changes].sort((left, right) => {
    const leftRank = defaultCategoryOrder.indexOf(left.type);
    const rightRank = defaultCategoryOrder.indexOf(right.type);
    return (
      (leftRank === -1 ? defaultCategoryOrder.length : leftRank) -
      (rightRank === -1 ? defaultCategoryOrder.length : rightRank)
    );
  });
}

function structuralShape(changeLog: ChangeLog): unknown {
  return {
    title: changeLog.title,
    versions: changeLog.versions.map((version) => ({
      title: version.title,
      version: version.version,
      date: version.date,
      types: version.changes.map(({ type }) => type),
      categoryNames: Object.keys(version.categories),
    })),
  };
}

function assertOutputTypes(changeLog: ChangeLog, seed: number): void {
  assert.equal(typeof changeLog.title, "string", `title at seed ${seed}`);
  for (const version of changeLog.versions) {
    assert.equal(
      typeof version.title,
      "string",
      `version title at seed ${seed}`,
    );
    assert.equal(typeof version.body, "string", `version body at seed ${seed}`);
    assert.ok(
      version.version === null || typeof version.version === "string",
      `version at seed ${seed}`,
    );
    assert.ok(
      version.date === null || typeof version.date === "string",
      `date at seed ${seed}`,
    );
    for (const change of version.changes) {
      assert.equal(typeof change.type, "string", `change type at seed ${seed}`);
      assert.equal(typeof change.body, "string", `change body at seed ${seed}`);
    }
    for (const category of Object.values(version.categories)) {
      assert.ok(Array.isArray(category), `category at seed ${seed}`);
      for (const body of category) {
        assert.equal(typeof body, "string", `category body at seed ${seed}`);
      }
    }
  }
}

describe("generated parser properties", () => {
  for (const seeds of shardSeeds(256, 64)) {
    const range =
      seeds.length === 1
        ? `seed ${seeds[0]}`
        : `seeds ${seeds[0]}-${seeds.at(-1)}`;
    test(`matches generated models and preserves structure across formats (${range})`, () => {
      for (const seed of seeds) {
        const generated = generateChangeLog(seed);
        withSeedContext(
          "matches generated models",
          seed,
          generated.text,
          () => {
            const textOutput = parseChangeLog({
              text: generated.text,
              outputFormat: "text",
            });
            assert.equal(
              textOutput.title,
              generated.title,
              `title at seed ${seed}`,
            );
            assert.equal(
              textOutput.versions.length,
              generated.versions.length,
              `version count at seed ${seed}`,
            );

            for (let index = 0; index < generated.versions.length; index += 1) {
              assert.equal(
                textOutput.versions[index].title,
                generated.versions[index].title,
                `version title at seed ${seed}, index ${index}`,
              );
              assert.deepEqual(
                textOutput.versions[index].changes,
                sortChanges(generated.versions[index].sourceChanges),
                `changes at seed ${seed}, index ${index}`,
              );
            }

            const htmlOutput = parseChangeLog({
              text: generated.text,
              outputFormat: "html",
            });
            const markdownOutput = parseChangeLog({
              text: generated.text,
              outputFormat: "markdown",
            });
            assert.deepEqual(
              structuralShape(htmlOutput),
              structuralShape(textOutput),
              `HTML structure at seed ${seed}`,
            );
            assert.deepEqual(
              structuralShape(markdownOutput),
              structuralShape(textOutput),
              `Markdown structure at seed ${seed}`,
            );
            assertOutputTypes(textOutput, seed);
            assertOutputTypes(htmlOutput, seed);
            assertOutputTypes(markdownOutput, seed);
          },
        );
      }
    }, 30_000);
  }

  test("covers intended generated-model features", () => {
    if (propertySeed !== null) return;
    const counts = new Map<string, number>();
    for (const seed of selectSeeds(256)) {
      for (const feature of generateChangeLog(seed).features) {
        counts.set(feature, (counts.get(feature) ?? 0) + 1);
      }
    }
    for (const feature of generatedModelFeatures) {
      assert.ok(
        (counts.get(feature) ?? 0) > 0,
        `generated-model feature ${feature}; counts=${JSON.stringify(Object.fromEntries(counts))}`,
      );
    }
  });

  test("sorting changes order but not content", () => {
    for (const seed of selectSeeds(256)) {
      const generated = generateChangeLog(seed);
      withSeedContext("sorting changes order", seed, generated.text, () => {
        const unsorted = parseChangeLog({
          text: generated.text,
          categorySortOrder: null,
          outputFormat: "text",
        });
        for (let index = 0; index < generated.versions.length; index += 1) {
          assert.deepEqual(
            unsorted.versions[index].changes,
            generated.versions[index].sourceChanges,
            `source order at seed ${seed}, index ${index}`,
          );
        }
      });
    }
  }, 30_000);

  test("omitted, explicit, and undefined defaults are equivalent", () => {
    for (const seed of selectSeeds(128)) {
      const { text } = generateChangeLog(seed);
      withSeedContext(
        "omitted, explicit, and undefined defaults",
        seed,
        text,
        () => {
          const omitted = parseChangeLog({ text });
          const explicit = parseChangeLog({
            text,
            categorySortOrder: defaultCategoryOrder,
            defaultTitle: "Release Notes",
            omitUnreleasedVersions: true,
            outputFormat: "html",
            recognizeColonSections: true,
          });
          const undefinedOptions = parseChangeLog({
            text,
            categorySortOrder: undefined,
            defaultTitle: undefined,
            omitUnreleasedVersions: undefined,
            outputFormat: undefined,
            recognizeColonSections: undefined,
          });
          assert.deepEqual(
            explicit,
            omitted,
            `explicit defaults at seed ${seed}`,
          );
          assert.deepEqual(
            undefinedOptions,
            omitted,
            `undefined defaults at seed ${seed}`,
          );
        },
      );
    }
  }, 30_000);

  test("stays well-typed for deterministic malformed-input fuzzing", () => {
    for (const seed of selectSeeds(512)) {
      const { text } = generateMalformedInput(seed);
      withSeedContext("malformed-input fuzzing", seed, text, () => {
        for (const outputFormat of ["html", "markdown", "text"] as const) {
          assertOutputTypes(parseChangeLog({ text, outputFormat }), seed);
        }
      });
    }
  }, 30_000);

  test("covers every malformed-input fragment", () => {
    if (propertySeed !== null) return;
    const observed = new Set<string>();
    for (const seed of selectSeeds(512)) {
      for (const feature of generateMalformedInput(seed).features) {
        observed.add(feature);
      }
    }
    for (const fragment of malformedFragments) {
      assert.ok(
        observed.has(fragment),
        `malformed-input fragment ${JSON.stringify(fragment)}; observed=${JSON.stringify([...observed])}`,
      );
    }
  });

  test("handles a bounded large input", () => {
    const sections = Array.from(
      { length: 200 },
      (_, index) => `## 1.0.${index}\n\n### Fixed\n\n- change-${index}\n`,
    );
    const changeLog = parseChangeLog({
      text: sections.join("\n"),
      outputFormat: "text",
    });
    expect(changeLog.versions).toHaveLength(200);
    expect(changeLog.versions.at(-1)?.changes[0].body).toBe("change-199");
  });
});
