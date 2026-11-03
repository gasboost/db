import { createNodeLockState } from "@gasboost/fake-node";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let compiled: string;
beforeAll(() => {
  // Compile current sources so native workers exercise the implementation without
  // relying on dist from a previous build or a Vitest-only module loader.
  compiled = mkdtempSync(resolve("node_modules/.sheetorm-lock-"));
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json",
    "--outDir", compiled, "--declaration", "false"], { cwd: resolve(".") });
}, 30000);
afterAll(() => { if (compiled) rmSync(compiled, { recursive: true, force: true }); });

async function runWorkers(tableNames: string[], userIds: string[], parallel = false) {
  const contexts = userIds.map((userId) => ({ scriptId: "workers", userId }));
  const locks = createNodeLockState(contexts);
  const state = new SharedArrayBuffer(8 * 4);
  const cache = new SharedArrayBuffer(512 * 4);
  const workers = tableNames.map((tableName, index) => new Worker(
    resolve("tests/fixtures/table-lock-worker.cjs"),
    { workerData: {
      tableModule: resolve(compiled, "core/SheetTable.js"), tableName,
      userId: userIds[index], locks, state, cache, workers: tableNames.length,
      iterations: parallel ? 1 : 8, parallel,
    } },
  ));
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Worker exited: ${code}`)));
    })));
    const results = new Int32Array(state);
    expect(results[3]).toBe(0); // No overlapping writers for either table.
    expect(results[5]).toBe(parallel ? 2 : tableNames.length * 8);
    expect(new Int32Array(cache)[0]).toBe(0);
    expect(new Int32Array(cache)[256]).toBe(0);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

describe("table leases across native workers with shared cache AND lock state", () => {
  it.each([["same", "same"], ["one", "two"]])(
    "serializes the same table for users %s / %s",
    async (first, second) => {
      await runWorkers(["users", "users"], [first, second]);
    }, 15000,
  );
  it.each([["same", "same"], ["one", "two"]])(
    "allows independent table I/O for users %s / %s",
    async (first, second) => {
      await runWorkers(["users", "orders"], [first, second], true);
    }, 15000,
  );
});
