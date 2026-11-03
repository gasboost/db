const { workerData } = require("node:worker_threads");
const { SheetTable } = require(workerData.tableModule);
const { z } = require("zod");
const { NodeLockService, NodeUtilities } = require("@gasboost/fake-node");
const assert = require("node:assert/strict");

const state = new Int32Array(workerData.state);
const cacheData = new Int32Array(workerData.cache);
const lockService = new NodeLockService({
  scriptId: "workers", userId: workerData.userId, sharedState: workerData.locks,
});
let lastScriptLock;
const getScriptLock = lockService.getScriptLock.bind(lockService);
lockService.getScriptLock = () => (lastScriptLock = getScriptLock());
const scriptIndex = workerData.locks.keys.indexOf(JSON.stringify(["script", "workers"]));
const scriptState = new Int32Array(workerData.locks.buffer);
const slot = (key) => key === "db:users" ? 0 : 256;
const assertLocked = () => assert.equal(Atomics.load(scriptState, scriptIndex), 1);
// Every worker reads and writes the SAME backing buffer. Deliberately non-atomic
// multi-step cache operations expose races unless SheetTable holds ScriptLock.
const cache = {
  get(key) {
    assertLocked();
    const offset = slot(key);
    const length = cacheData[offset];
    Atomics.wait(state, 7, 0, 1);
    return length ? String.fromCharCode(...cacheData.slice(offset + 1, offset + 1 + length)) : null;
  },
  put(key, token, ttl) {
    assertLocked();
    assert.equal(ttl, 300);
    const offset = slot(key);
    for (let i = 0; i < token.length; i++) cacheData[offset + 1 + i] = token.charCodeAt(i);
    cacheData[offset] = token.length;
  },
  remove(key) {
    assertLocked();
    cacheData[slot(key)] = 0;
  },
};
const table = new SheetTable({
  dbId: "db", name: workerData.tableName, primaryKey: "id",
  schema: z.object({ id: z.number() }),
});
const utilities = new NodeUtilities();
Atomics.add(state, 0, 1);
Atomics.notify(state, 0);
while (Atomics.load(state, 0) < workerData.workers) {
  const count = Atomics.load(state, 0);
  if (count < workerData.workers) Atomics.wait(state, 0, count, 5000);
}
for (let i = 0; i < workerData.iterations; i++) {
  table.lock(cache, utilities, lockService);
  // No ScriptLock may remain held during simulated table I/O.
  assert.equal(lastScriptLock.hasLock(), false);
  const activeIndex = workerData.tableName === "users" ? 1 : 2;
  if (Atomics.add(state, activeIndex, 1) !== 0) Atomics.add(state, 3, 1);
  if (workerData.parallel) {
    Atomics.add(state, 4, 1);
    Atomics.notify(state, 4);
    const deadline = Date.now() + 5000;
    while (Atomics.load(state, 4) < 2 && Date.now() < deadline) {
      Atomics.wait(state, 4, 1, 100);
    }
    assert.equal(Atomics.load(state, 4), 2, "independent tables must hold leases concurrently");
  }
  Atomics.wait(state, 7, 0, 3);
  Atomics.add(state, 5, 1);
  Atomics.sub(state, activeIndex, 1);
  table.releaseLock();
}
