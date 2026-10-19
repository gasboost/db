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
const rtdb = new FirebaseRtdb({ versionStore: { next: () => 1 }, transport: { patch: () => {} } });
rtdb.publish([{ table: "employees" }]);
void [FirebaseCustomToken, FirebaseRtdbRestTransport, PropertiesVersionStore, rtdb.rules()];
`);
writeFileSync("client.ts", 'export { versionPath } from "@gasboost/realtime-firebase/client";\n');
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
    // The only package module in the browser bundle must be its client entry.
    const modules = Object.keys(chunk.modules).filter((id) => id.includes("/realtime-firebase/"));
    assert.ok(modules.some((id) => id.endsWith("/dist/client.js")));
    assert.ok(modules.every((id) => id.endsWith("/dist/client.js")));
  }
}
const browser = {};
runInNewContext(readFileSync("bundle/client.js", "utf8"), browser);
assert.deepEqual(Object.keys(browser.ClientSmoke), ["versionPath"]);
assert.equal(browser.ClientSmoke.versionPath("employees"), "/syncVersions/employees");
console.log("Packed backend types and isolated browser client bundle passed.");
