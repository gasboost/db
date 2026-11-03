import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeLockService, NodeUtilities } from "@gasboost/fake-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SheetTable } from "../../src/core/SheetTable";
import { SheetDB, InMemoryGateway, InMemoryDataStore } from "../../src";

function setup() {
  const cache = new InMemoryCacheService().getScriptCache();
  const utilities = new NodeUtilities();
  const lockService = new NodeLockService({ scriptId: "atomic-test", userId: "one" });
  const contender = new NodeLockService({ scriptId: "atomic-test", userId: "two" });
  const scriptLock = lockService.getScriptLock();
  vi.spyOn(lockService, "getScriptLock").mockReturnValue(scriptLock);
  const table = <const N extends string = "users">(name: N = "users" as N) => new SheetTable<N, z.ZodObject<{ id: z.ZodNumber }>>({
    dbId: "db", name, primaryKey: "id", schema: z.object({ id: z.number() }),
  });
  return { cache, utilities, lockService, contender, scriptLock, table };
}

afterEach(() => vi.restoreAllMocks());

describe("atomic table ownership", () => {
  it("protects every ownership read/write/remove, and releases before sleep", () => {
    const { cache, utilities, lockService, contender, table } = setup();
    const other = contender.getScriptLock();
    for (const method of ["get", "put", "remove"] as const) {
      const original = cache[method].bind(cache) as (...args: any[]) => any;
      vi.spyOn(cache, method).mockImplementation(((...args: any[]) => {
        expect(other.tryLock(0)).toBe(false);
        return original(...args);
      }) as any);
    }
    const first = table();
    const second = table();
    first.lock(cache, utilities, lockService);
    vi.spyOn(utilities, "sleep").mockImplementation((ms) => {
      expect(ms).toBe(200);
      expect(other.tryLock(0)).toBe(true);
      other.releaseLock();
      first.releaseLock();
    });
    second.lock(cache, utilities, lockService);
    second.releaseLock();
    expect(utilities.sleep).toHaveBeenCalledOnce();
  });

  it("allows independent table leases and preserves borrowed release responsibility", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    const first = table();
    const second = table("orders");
    const release = first.holdLock(cache, utilities, lockService);
    first.holdLock(cache, utilities, lockService)();
    expect(cache.get("db:users")).not.toBeNull();
    second.lock(cache, utilities, lockService);
    expect(scriptLock.hasLock()).toBe(false);
    expect(cache.get("db:orders")).not.toBeNull();
    release();
    expect(cache.get("db:users")).toBeNull();
    second.releaseLock();
  });

  it("does not let an obsolete scope release a newly acquired lease", () => {
    const { cache, utilities, lockService, table } = setup();
    const users = table();
    const oldRelease = users.holdLock(cache, utilities, lockService);
    cache.remove("db:users"); // Lease expiry / eviction.
    const release = users.holdLock(cache, utilities, lockService);
    oldRelease();
    expect(cache.get("db:users")).not.toBeNull();
    release();
    expect(cache.get("db:users")).toBeNull();
  });

  it.each(["get", "put"] as const)("releases ScriptLock when cache.%s throws", (method) => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    vi.spyOn(cache, method).mockImplementationOnce(() => { throw new Error("cache failure"); });
    const users = table();
    expect(() => users.lock(cache, utilities, lockService)).toThrow("cache failure");
    expect(scriptLock.hasLock()).toBe(false);
    users.releaseLock();
  });

  it.each(["get", "remove"] as const)("clears local state and releases ScriptLock on release %s errors", (method) => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    const users = table();
    users.lock(cache, utilities, lockService);
    vi.spyOn(cache, method).mockImplementationOnce(() => { throw new Error("release failure"); });
    expect(() => users.releaseLock()).toThrow("release failure");
    expect(scriptLock.hasLock()).toBe(false);
    expect(() => users.releaseLock()).not.toThrow();
    cache.remove("db:users");
    users.lock(cache, utilities, lockService);
    users.releaseLock();
  });

  it("bounds ScriptLock attempts and sleep by the remaining outer deadline", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const attempts: number[] = [];
    vi.spyOn(scriptLock, "tryLock").mockImplementation((ms) => {
      attempts.push(ms);
      now += ms;
      return false;
    });
    vi.spyOn(utilities, "sleep").mockImplementation((ms) => { now += ms; });
    expect(() => table().lock(cache, utilities, lockService)).toThrow("cache lock timeout (300000ms)");
    expect(now).toBe(300000);
    expect(attempts.every((ms) => ms > 0 && ms <= 200)).toBe(true);
    expect(cache.get("db:users")).toBeNull();
  });

  it("releases a ScriptLock even if acquisition throws after taking it", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    const acquire = scriptLock.tryLock.bind(scriptLock);
    vi.spyOn(scriptLock, "tryLock").mockImplementation((ms) => {
      acquire(ms);
      throw new Error("acquisition failure");
    });
    expect(() => table().lock(cache, utilities, lockService)).toThrow("acquisition failure");
    expect(scriptLock.hasLock()).toBe(false);
  });

  it("clears state when release cannot acquire ScriptLock", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    const users = table();
    users.lock(cache, utilities, lockService);
    vi.spyOn(scriptLock, "waitLock").mockImplementationOnce(() => { throw new Error("timeout"); });
    expect(() => users.releaseLock()).toThrow("timeout");
    expect(scriptLock.hasLock()).toBe(false);
    expect(cache.get("db:users")).not.toBeNull();
    expect(() => users.releaseLock()).not.toThrow();
  });
  it("leaves ScriptLock free throughout Gateway I/O and afterCommit", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    const cacheService = new InMemoryCacheService();
    vi.spyOn(cacheService, "getScriptCache").mockReturnValue(cache);
    const gateway = new InMemoryGateway(new InMemoryDataStore(new Map([
      ["db:users", [["id"]]],
    ])));
    for (const method of ["table", "read", "readMany", "insert", "update", "delete",
      "rewrite", "setColumns", "count", "lastId"] as const) {
      const original = gateway[method].bind(gateway) as (...args: any[]) => any;
      vi.spyOn(gateway, method).mockImplementation(((...args: any[]) => {
        expect(scriptLock.hasLock()).toBe(false);
        return original(...args);
      }) as any);
    }
    const users = table("users");
    const db = new SheetDB({
      tables: [users] as const, gateway, cacheService, utilities, lockService,
      afterCommit: () => { expect(scriptLock.hasLock()).toBe(false); },
    });
    db.migrate();
    db.seed("users", [{ id: 1 }]);
    db.table("users").create([{ id: 2 }]);
    db.table("users").update([{ id: 2 }]);
    db.transaction(() => { db.table("users").create([{ id: 3 }]); });
    db.table("users").delete([2]);
    expect(db.table("users").find().map((row) => row.id)).toEqual([1, 3]);
    expect(cache.get("db:users")).toBeNull();
  });

  it("releases the acquiring scope on Consumer failure without releasing a borrowed lease", () => {
    const { cache, utilities, lockService, table } = setup();
    const users = table();
    const release = users.holdLock(cache, utilities, lockService);
    const borrow = users.holdLock(cache, utilities, lockService);
    expect(() => {
      try { throw new Error("consumer failure"); } finally { borrow(); }
    }).toThrow("consumer failure");
    expect(cache.get("db:users")).not.toBeNull();
    expect(() => {
      try { throw new Error("consumer failure"); } finally { release(); }
    }).toThrow("consumer failure");
    expect(cache.get("db:users")).toBeNull();
  });

  it("rejects acquisition at the deadline and still frees ScriptLock", () => {
    const { cache, utilities, lockService, scriptLock, table } = setup();
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const acquire = scriptLock.tryLock.bind(scriptLock);
    vi.spyOn(scriptLock, "tryLock").mockImplementation(() => {
      acquire(0);
      now = 300000;
      return true;
    });
    expect(() => table().lock(cache, utilities, lockService)).toThrow("cache lock timeout");
    expect(scriptLock.hasLock()).toBe(false);
    expect(cache.get("db:users")).toBeNull();
  });

});
