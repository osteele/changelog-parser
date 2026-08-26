import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error The Node audit helper intentionally remains plain ESM.
import { createMutationSandboxManager } from "../scripts/mutation-sandbox.mjs";

function createProject(): string {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "changelog-parser-mutation-"),
  );
  fs.mkdirSync(path.join(projectRoot, ".cache"));
  return projectRoot;
}

test("keeps concurrent mutation runs isolated", () => {
  const projectRoot = createProject();
  try {
    const first = createMutationSandboxManager(projectRoot);
    first.start();
    const firstSandbox = first.createSandbox();

    const second = createMutationSandboxManager(projectRoot);
    second.start();
    expect(fs.existsSync(firstSandbox)).toBe(true);

    second.cleanup();
    expect(fs.existsSync(firstSandbox)).toBe(true);
    first.cleanup();
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
  }
});

test("rejects a symlinked mutation sandbox root", () => {
  const projectRoot = createProject();
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "changelog-parser-external-"),
  );
  try {
    fs.symlinkSync(
      externalRoot,
      path.join(projectRoot, ".cache", "mutation-sandboxes"),
    );
    const manager = createMutationSandboxManager(projectRoot);
    expect(() => manager.start()).toThrow("unsafe mutation directory");
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
    fs.rmSync(externalRoot, { recursive: true });
  }
});

test("reconciles only a dead run's owned sandboxes", () => {
  const projectRoot = createProject();
  const sandboxRoot = path.join(projectRoot, ".cache", "mutation-sandboxes");
  const runId = "run-99999999-stale";
  const runRoot = path.join(sandboxRoot, runId);
  try {
    fs.mkdirSync(path.join(runRoot, "sandbox-stale"), { recursive: true });
    fs.writeFileSync(
      path.join(runRoot, "owner.json"),
      `${JSON.stringify({ pid: 99_999_999, runId })}\n`,
    );

    const manager = createMutationSandboxManager(projectRoot);
    manager.start();
    expect(fs.existsSync(runRoot)).toBe(false);
    manager.cleanup();
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
  }
});

test("rejects owner metadata that disagrees with the run name", () => {
  const projectRoot = createProject();
  const sandboxRoot = path.join(projectRoot, ".cache", "mutation-sandboxes");
  const runId = "run-99999999-mismatch";
  const runRoot = path.join(sandboxRoot, runId);
  try {
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(
      path.join(runRoot, "owner.json"),
      `${JSON.stringify({ pid: process.pid, runId })}\n`,
    );

    const manager = createMutationSandboxManager(projectRoot);
    expect(() => manager.start()).toThrow("Invalid mutation owner metadata");
    expect(fs.existsSync(runRoot)).toBe(true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
  }
});

test("reconciles an ownerless dead run", () => {
  const projectRoot = createProject();
  const runRoot = path.join(
    projectRoot,
    ".cache",
    "mutation-sandboxes",
    "run-99999999-ownerless",
  );
  try {
    fs.mkdirSync(path.join(runRoot, "sandbox-stale"), { recursive: true });
    const manager = createMutationSandboxManager(projectRoot);
    manager.start();
    expect(fs.existsSync(runRoot)).toBe(false);
    manager.cleanup();
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
  }
});

test("tolerates a stale run claimed by another reconciler", () => {
  const projectRoot = createProject();
  const runRoot = path.join(
    projectRoot,
    ".cache",
    "mutation-sandboxes",
    "run-99999999-ownerless",
  );
  try {
    fs.mkdirSync(runRoot, { recursive: true });
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
      originalRename(source, destination);
      fs.rmSync(destination, { recursive: true });
      throw Object.assign(new Error("claimed concurrently"), {
        code: "ENOENT",
      });
    };
    try {
      const manager = createMutationSandboxManager(projectRoot);
      manager.start();
      manager.cleanup();
    } finally {
      fs.renameSync = originalRename;
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true });
  }
});
