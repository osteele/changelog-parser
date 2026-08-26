import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const runPrefix = "run-";
const sandboxPrefix = "sandbox-";
const ownerFileName = "owner.json";

export function createMutationSandboxManager(projectRoot) {
  const sandboxRoot = path.join(
    path.resolve(projectRoot),
    ".cache",
    "mutation-sandboxes",
  );
  const activeSandboxes = new Set();
  let runRoot = null;
  let runId = null;

  function validateDirectory(directory, expectedParent) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Refusing unsafe mutation directory: ${directory}`);
    }
    if (
      expectedParent !== undefined &&
      path.dirname(fs.realpathSync(directory)) !==
        fs.realpathSync(expectedParent)
    ) {
      throw new Error(`Mutation directory escaped its parent: ${directory}`);
    }
  }

  function validateRoot() {
    const cacheRoot = path.dirname(sandboxRoot);
    fs.mkdirSync(cacheRoot, { recursive: true });
    validateDirectory(cacheRoot, path.resolve(projectRoot));
    fs.mkdirSync(sandboxRoot, { recursive: true });
    validateDirectory(sandboxRoot, cacheRoot);
  }

  function readOwner(directory) {
    const ownerPath = path.join(directory, ownerFileName);
    const stat = fs.lstatSync(ownerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Invalid mutation owner file: ${ownerPath}`);
    }
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    const runPid = getRunPid(directory);
    if (
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      owner.pid !== runPid ||
      owner.runId !== path.basename(directory).replace(/\.cleanup-\d+-.+$/, "")
    ) {
      throw new Error(`Invalid mutation owner metadata: ${ownerPath}`);
    }
    return owner;
  }

  function getRunPid(directory) {
    const match = /^run-(\d+)-/.exec(path.basename(directory));
    if (!match) throw new Error(`Invalid mutation run name: ${directory}`);
    return Number(match[1]);
  }

  function validateRun(directory) {
    if (
      path.dirname(directory) !== sandboxRoot ||
      !path.basename(directory).startsWith(runPrefix)
    ) {
      throw new Error(`Refusing unexpected mutation run: ${directory}`);
    }
    validateRoot();
    validateDirectory(directory, sandboxRoot);
    return readOwner(directory);
  }

  function validateSandbox(sandbox, parentRun) {
    if (
      path.dirname(sandbox) !== parentRun ||
      !path.basename(sandbox).startsWith(sandboxPrefix)
    ) {
      throw new Error(`Refusing unexpected mutation sandbox: ${sandbox}`);
    }
    validateRun(parentRun);
    validateDirectory(sandbox, parentRun);
  }

  function removeSandbox(sandbox) {
    if (!fs.existsSync(sandbox)) return;
    if (runRoot === null) {
      throw new Error("Mutation sandbox manager has not started");
    }
    validateSandbox(sandbox, runRoot);
    fs.rmSync(sandbox, { recursive: true });
    activeSandboxes.delete(sandbox);
  }

  function removeRun(directory, ownerRequired = true) {
    validateRoot();
    validateDirectory(directory, sandboxRoot);
    getRunPid(directory);
    const ownerPath = path.join(directory, ownerFileName);
    if (ownerRequired || fs.existsSync(ownerPath)) readOwner(directory);
    const sandboxes = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.name === ownerFileName && entry.isFile()) continue;
      if (
        !entry.name.startsWith(sandboxPrefix) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        throw new Error(`Unexpected mutation run entry: ${target}`);
      }
      validateDirectory(target, directory);
      sandboxes.push(target);
    }
    for (const target of sandboxes) {
      fs.rmSync(target, { recursive: true });
      activeSandboxes.delete(target);
    }
    if (fs.existsSync(ownerPath)) fs.unlinkSync(ownerPath);
    fs.rmdirSync(directory);
  }

  function isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      if (error?.code === "EPERM") return true;
      throw error;
    }
  }

  function reconcileRuns() {
    validateRoot();
    for (const entry of fs.readdirSync(sandboxRoot, { withFileTypes: true })) {
      if (!entry.name.startsWith(runPrefix)) continue;
      const directory = path.join(sandboxRoot, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Unexpected mutation run entry: ${directory}`);
      }
      const pid = getRunPid(directory);
      if (isProcessAlive(pid)) continue;
      const claimed = `${directory}.cleanup-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(directory, claimed);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      try {
        removeRun(claimed, false);
      } catch (error) {
        try {
          fs.renameSync(claimed, directory);
        } catch (restoreError) {
          error.cause = restoreError;
        }
        throw error;
      }
    }
  }

  function start() {
    if (runRoot !== null) {
      throw new Error("Mutation sandbox manager is already started");
    }
    reconcileRuns();
    runId = `${runPrefix}${process.pid}-${randomUUID()}`;
    runRoot = path.join(sandboxRoot, runId);
    fs.mkdirSync(runRoot);
    fs.writeFileSync(
      path.join(runRoot, ownerFileName),
      `${JSON.stringify({ pid: process.pid, runId })}\n`,
      { flag: "wx" },
    );
  }

  function createSandbox() {
    if (runRoot === null) {
      throw new Error("Mutation sandbox manager has not started");
    }
    validateRun(runRoot);
    const sandbox = fs.mkdtempSync(path.join(runRoot, sandboxPrefix));
    activeSandboxes.add(sandbox);
    return sandbox;
  }

  function cleanup() {
    if (runRoot === null || !fs.existsSync(runRoot)) return;
    for (const sandbox of [...activeSandboxes]) removeSandbox(sandbox);
    removeRun(runRoot);
    runRoot = null;
    runId = null;
  }

  return {
    cleanup,
    createSandbox,
    removeSandbox,
    start,
  };
}
