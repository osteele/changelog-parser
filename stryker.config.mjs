export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test tests/contracts.test.ts",
  },
  coverageAnalysis: "off",
  concurrency: 1,
  mutate: [
    "src/index.ts:68-802",
    "src/index.ts:804-888",
    "src/index.ts:1271-1564",
  ],
  mutator: {
    // Generic regex mutation creates many equivalent anchor changes for the
    // single-character predicates here. The curated tier owns regex semantics.
    excludedMutations: ["Regex"],
  },
  reporters: ["clear-text", "json"],
  jsonReporter: {
    fileName: ".cache/stryker-resource.json",
  },
  tempDirName: ".cache/stryker-tmp",
  // Bun transpiles the command-runner tests; this bypasses Stryker's
  // TypeScript 7-incompatible tsconfig rewriting.
  tsconfigFile: ".cache/stryker-no-tsconfig.json",
  cleanTempDir: "always",
  timeoutMS: 5_000,
  thresholds: {
    high: 80,
    low: 60,
    break: 60,
  },
};
