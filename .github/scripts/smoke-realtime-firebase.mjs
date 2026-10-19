// Copy into an isolated consumer with the packed package, TypeScript and Vite installed.
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { build } from "vite";

writeFileSync("backend.ts", `
import {
  FirebaseCustomToken, FirebaseRtdb, FirebaseRtdbRestTransport, PropertiesVersionStore,
  type FirebaseServiceAccount, type FirebaseCustomTokenUtilities, type VersionStore,
} from "@gasboost/realtime-firebase";
import { productsTable } from "./shared";
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
console.log("Packed backend types and isolated browser client bundle passed.");
