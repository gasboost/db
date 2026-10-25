// Copy into an isolated consumer with the packed package, TypeScript and Vite installed.
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { build } from "vite";

writeFileSync("backend.ts", `
import {
  FirebaseCustomToken, FirebaseRtdb, FirebaseRtdbRestTransport, PropertiesVersionStore,
  type FirebaseServiceAccount, type FirebaseCustomTokenUtilities, type VersionStore,
} from "@gasboost/realtime-firebase";
import { productsTable } from "./shared";
import {
  FirebaseRtdbEmulatorTransport, type FirebaseRtdbEmulatorTransportConfig,
  type RtdbTransport, type RtdbUpdates, type RtdbUrlFetchApp,
} from "@gasboost/realtime-firebase/emulator";
const urlFetchApp: RtdbUrlFetchApp = {
  fetch: () => ({ getResponseCode: () => 200, getContentText: () => "{}" }),
};
const emulatorConfig: FirebaseRtdbEmulatorTransportConfig = {
  databaseName: "demo-smoke-default-rtdb", urlFetchApp,
};
const emulator: RtdbTransport = new FirebaseRtdbEmulatorTransport(emulatorConfig);
const updates: RtdbUpdates = { "syncVersions/employees": 1 };
emulator.patch(updates);
const rtdb = new FirebaseRtdb({ versionStore: { next: () => 1 }, transport: { patch: () => {} } });
rtdb.publish([{ table: productsTable.name }]);
void [FirebaseCustomToken, FirebaseRtdbRestTransport, PropertiesVersionStore, rtdb.rules()];
`);
writeFileSync("shared.ts", `
import { defineTable } from "@gasboost/table";
import { z } from "zod";
export const productsTable = defineTable({
  name: "sales.2026", schema: z.object({ id: z.string() }), primaryKey: "id",
});
`);
writeFileSync("client.ts", `
import { versionPath } from "@gasboost/realtime-firebase/client";
import { productsTable } from "./shared";
export const productsPath = versionPath(productsTable);
export const renamedPath = versionPath({ ...productsTable, name: "items" });
`);
writeFileSync("tsconfig.json", JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, skipLibCheck: false, types: [], noEmit: true,
  },
  include: ["backend.ts", "client.ts"],
}));
execFileSync("pnpm", ["exec", "tsc"], { stdio: "inherit" });
const require = createRequire(new URL("package.json", `file://${process.cwd()}/`));
const { FirebaseRtdbEmulatorTransport } = require("@gasboost/realtime-firebase/emulator");
const requests = [];
new FirebaseRtdbEmulatorTransport({
  databaseName: "demo-smoke-default-rtdb",
  urlFetchApp: {
    fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => "{}" };
    },
  },
}).patch({ "syncVersions/employees": 1 });
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "http://127.0.0.1:9000/.json?ns=demo-smoke-default-rtdb");
assert.equal(requests[0].options.headers.Authorization, "Bearer owner");
assert.deepEqual(JSON.parse(requests[0].options.payload), { "syncVersions/employees": 1 });
const result = await build({
  configFile: false,
  build: {
    outDir: "bundle",
    minify: false,
    lib: { entry: "client.ts", name: "ClientSmoke", formats: ["iife"], fileName: () => "client.js" },
  },
});
const outputs = Array.isArray(result) ? result : [result];
for (const output of outputs) {
  for (const chunk of output.output) {
    if (chunk.type !== "chunk") continue;
    assert.deepEqual(chunk.imports, []);
    assert.deepEqual(chunk.dynamicImports, []);
    // Only the client entry and shared sanitizer may enter the browser bundle.
    const modules = Object.keys(chunk.modules).filter((id) => id.includes("/realtime-firebase/"));
    assert.ok(modules.some((id) => id.endsWith("/dist/client.js")));
    assert.ok(modules.every((id) =>
      id.endsWith("/dist/client.js") || id.endsWith("/dist/sanitizeTableName.js"),
    ));
  }
}
const browser = {};
runInNewContext(readFileSync("bundle/client.js", "utf8"), browser);
assert.deepEqual(Object.keys(browser.ClientSmoke).sort(), ["productsPath", "renamedPath"]);
assert.equal(browser.ClientSmoke.productsPath, "/syncVersions/sales2026");
assert.equal(browser.ClientSmoke.renamedPath, "/syncVersions/items");
console.log("Packed backend/emulator types, emulator runtime and isolated browser client bundle passed.");
